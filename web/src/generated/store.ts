import type { AgentEvent, Concept, GenerateStatus } from '@mise/shared'
import { create } from 'zustand'
import { api } from '@/api'

/**
 * Lane B: one task per image target ("logo" or a MenuItem id) of a concept.
 *
 * DishCard and Logo call ensure() when they render, so any concept on screen gets its images
 * without anyone asking. The server caches by prompt hash, so asking again is cheap.
 * A task restarts only when the inputs to its prompt change (dish text, cuisine, brand colors).
 */

export type TaskStatus = 'generating' | 'done' | 'failed' | 'off'

export type GenTask = {
  target: string
  status: TaskStatus
  /** Current image. Kept on screen while a new take generates, and after a failed regenerate. */
  url: string | null
  inputKey: string
  startedAt: number
  /** Server time of the last finished call. */
  ms: number | null
  serverStatus: GenerateStatus | null
  error: string | null
}

type GenState = {
  tasks: Record<string, GenTask>
  /** Start the target if it has no task yet, or if its prompt inputs changed. */
  ensure: (concept: Concept, target: string) => void
  /** Make a new take, even if one is cached. Also the retry for a failed task. */
  regenerate: (concept: Concept, target: string) => void
  /** Logo first, then every dish. */
  ensureAll: (concept: Concept) => void
  /** For Lane A: feed agent `generating` / `generated` events so both sources share one state. */
  ingestAgentEvent: (event: AgentEvent, concept: Concept | null) => void
}

export const taskKey = (conceptId: string, target: string) => `${conceptId}/${target}`

/** Mirrors what the server puts in each prompt (server/src/generate/prompts.ts). */
export function inputKey(concept: Concept, target: string): string {
  const { primary, background } = concept.brand.colors
  const base = [concept.cuisine.join(','), primary, background]
  if (target === 'logo') {
    return JSON.stringify([...base, concept.name, concept.tagline, concept.brand.logoPrompt ?? ''])
  }
  const item = concept.menu.find((m) => m.id === target)
  return JSON.stringify([...base, item?.imagePrompt?.trim() || `${item?.name}. ${item?.description}`])
}

/* Max 4 requests in flight. The page is HTTP/1.1 (6 sockets per host), so this leaves room for
 * the agent stream and /api/simulate while images generate. */
const MAX_IN_FLIGHT = 4
let inFlight = 0
const waiting: (() => void)[] = []
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight < MAX_IN_FLIGHT) inFlight++
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await fn()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else inFlight--
  }
}

/** Latest request id per task. A response for an older request is dropped. */
const latest = new Map<string, number>()
let requestSeq = 0

export const useGeneration = create<GenState>()((set, get) => {
  const patch = (key: string, p: Partial<GenTask>) =>
    set((s) => (s.tasks[key] ? { tasks: { ...s.tasks, [key]: { ...s.tasks[key], ...p } } } : s))

  async function start(concept: Concept, target: string, regenerate: boolean) {
    const key = taskKey(concept.id, target)
    const id = ++requestSeq
    latest.set(key, id)
    const prev = get().tasks[key]
    set((s) => ({
      tasks: {
        ...s.tasks,
        [key]: {
          target,
          status: 'generating',
          url: prev?.url ?? null,
          inputKey: inputKey(concept, target),
          startedAt: Date.now(),
          ms: null,
          serverStatus: null,
          error: null,
        },
      },
    }))
    try {
      const r = await withSlot(async () => {
        if (latest.get(key) !== id) return null // superseded while queued
        if (target === 'logo') {
          const res = await api.generateLogo({ concept, regenerate })
          return { url: res.logoUrl, status: res.status ?? null, ms: res.ms ?? null, error: res.error ?? null }
        }
        const res = await api.generateDish({ concept, itemId: target, regenerate })
        return { url: res.imageUrl, status: res.status ?? null, ms: res.ms ?? null, error: res.error ?? null }
      })
      if (!r || latest.get(key) !== id) return
      const status: TaskStatus =
        r.status === 'failed' ? 'failed' : r.url ? 'done' : r.status === 'off' ? 'off' : 'failed'
      patch(key, { status, url: r.url ?? prev?.url ?? null, ms: r.ms, serverStatus: r.status, error: r.error })
    } catch (err) {
      if (latest.get(key) !== id) return
      patch(key, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    tasks: {},

    ensure: (concept, target) => {
      const task = get().tasks[taskKey(concept.id, target)]
      if (task && task.inputKey === inputKey(concept, target)) return
      void start(concept, target, false)
    },

    regenerate: (concept, target) => void start(concept, target, true),

    ensureAll: (concept) => {
      get().ensure(concept, 'logo')
      for (const item of concept.menu) get().ensure(concept, item.id)
    },

    ingestAgentEvent: (event, concept) => {
      if (!concept) return
      if (event.type === 'generating') get().ensure(concept, event.target)
      if (event.type === 'generated') {
        const key = taskKey(concept.id, event.target)
        const task = get().tasks[key]
        if (task?.status !== 'done') patch(key, { status: 'done', url: event.url })
      }
    },
  }
})

export const useGenTask = (conceptId: string, target: string): GenTask | undefined =>
  useGeneration((s) => s.tasks[taskKey(conceptId, target)])
