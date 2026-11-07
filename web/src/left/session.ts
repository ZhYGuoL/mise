import type { Concept, ConceptEdit, Prediction, Scenario } from '@mise/shared'
import { create } from 'zustand'

/** Lane A thread state. The concept and its versions live in the shared store (`@/state/store`). */

export type Step = { label: string; detail?: string }

export type EditStatus = 'pending' | 'applying' | 'applied' | 'skipped' | 'failed'

export type Block =
  | { kind: 'steps'; id: string; steps: Step[]; startedAt: number; endedAt: number | null }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'created'; id: string; version: number; name: string }
  | {
      kind: 'edits'
      id: string
      edits: ConceptEdit[]
      /** the concept the edit paths point into */
      base: Concept
      needsApproval: boolean
      byHand: boolean
      status: EditStatus
      /** which edits the owner kept, for approval cards */
      selected: boolean[]
      version: number | null
    }
  | { kind: 'photos'; id: string; targets: Record<string, 'running' | 'done'> ; closed: boolean }
  | {
      kind: 'sim'
      id: string
      scenario: Scenario
      version: number
      prediction: Prediction | null
      /** p50 orders of the version before, same scenario, for the delta */
      before: number | null
    }
  | { kind: 'error'; id: string; message: string }

export type Turn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'agent'; blocks: Block[]; done: boolean; byHand?: boolean }

type SessionState = {
  turns: Turn[]
  /** a model turn is running. Photos may still arrive after it ends. */
  busy: boolean
  /** composer text. The replay types into it. */
  draft: string
  /** image targets in flight, "logo" or a menu item id */
  generating: string[]
  /** menu item ids and fields that just changed, for the edit highlight */
  changed: string[]
  replaying: boolean
}

export const useSession = create<SessionState>()(() => ({
  turns: [],
  busy: false,
  draft: '',
  generating: [],
  changed: [],
  replaying: false,
}))

let seq = 0
export const uid = (p: string) => `${p}${++seq}`

/** Immutably update one agent turn. */
export function updateTurn(turnId: string, fn: (blocks: Block[]) => Block[], patch?: { done?: boolean }) {
  useSession.setState((s) => ({
    turns: s.turns.map((t) =>
      t.id === turnId && t.role === 'agent' ? { ...t, blocks: fn(t.blocks), ...(patch ?? {}) } : t,
    ),
  }))
}

export function updateBlock<K extends Block['kind']>(
  turnId: string,
  blockId: string,
  fn: (b: Extract<Block, { kind: K }>) => Extract<Block, { kind: K }>,
) {
  updateTurn(turnId, (blocks) => blocks.map((b) => (b.id === blockId ? fn(b as Extract<Block, { kind: K }>) : b)))
}

export function findBlock(blockId: string): { turnId: string; block: Block } | null {
  for (const t of useSession.getState().turns) {
    if (t.role !== 'agent') continue
    const block = t.blocks.find((b) => b.id === blockId)
    if (block) return { turnId: t.id, block }
  }
  return null
}
