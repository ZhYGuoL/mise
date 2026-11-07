import type { AgentEvent, Concept, ConceptEdit, OptimizeGoal, Prediction, Scenario } from '@mise/shared'
import { create } from 'zustand'
import { api } from '@/api'
import { runScenario } from '@/right/lib/data'
import { useMise } from '@/state/store'
import { startTurn } from '../client'
import { uid, updateTurn, useSession } from '../session'

/** Wave 2: `/optimize orders 120 friday`. Folds the optimize stream into one run, shown as one thread block. */

export type Candidate = { index: number; title: string; edits: ConceptEdit[]; prediction: Prediction | null }

export type Round = {
  round: number
  plan: string | null
  candidates: Candidate[]
  /** index of the kept candidate, null while running or when nothing beat the round start */
  kept: number | null
  settled: boolean
}

export type Run = {
  id: string
  goal: OptimizeGoal
  base: Concept
  startedAt: number
  endedAt: number | null
  start: Prediction | null
  rounds: Round[]
  checking: boolean
  final: Prediction | null
  /** baseline at the same runs as `final`, for the before and after */
  error: string | null
}

export const useOptimize = create<{ runs: Record<string, Run> }>()(() => ({ runs: {} }))

const patchRun = (id: string, fn: (r: Run) => Run) =>
  useOptimize.setState((s) => (s.runs[id] ? { runs: { ...s.runs, [id]: fn(s.runs[id]) } } : s))

const patchRound = (id: string, round: number, fn: (r: Round) => Round) =>
  patchRun(id, (run) => {
    const has = run.rounds.some((r) => r.round === round)
    const rounds = has
      ? run.rounds.map((r) => (r.round === round ? fn(r) : r))
      : [...run.rounds, fn({ round, plan: null, candidates: [], kept: null, settled: false })]
    return { ...run, rounds }
  })

export const metricOf = (goal: OptimizeGoal, p: Prediction) => (goal.metric === 'orders' ? p.orders.p50 : p.revenue.p50)
export const bandOf = (goal: OptimizeGoal, p: Prediction) => (goal.metric === 'orders' ? p.orders : p.revenue)

/* ───────────── args ───────────── */

const DAYS: Scenario['day'][] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "orders 120 friday", "revenue $2k sat rain", "150". Missing parts come from the current scenario. */
export function parseGoal(args: string, scenario: Scenario, current: Prediction | null): OptimizeGoal {
  let metric: OptimizeGoal['metric'] = 'orders'
  let target: number | null = null
  let day = scenario.day
  let weather = scenario.weather
  let event = scenario.event
  for (const raw of args.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    const tok = raw.replace(/[.!?]$/, '')
    if (/^(revenue|sales|dollars?)$/.test(tok)) metric = 'revenue'
    else if (/^orders?$/.test(tok)) metric = 'orders'
    else if (/^\$?\d+(\.\d+)?k?$/.test(tok)) {
      if (tok.startsWith('$')) metric = 'revenue'
      target = Number(tok.replace(/[$k]/g, '')) * (tok.endsWith('k') ? 1000 : 1)
    } else if (/^(rain|rainy)$/.test(tok)) weather = 'rain'
    else if (/^(snow|snowy)$/.test(tok)) weather = 'snow'
    else if (/^(clear|sunny)$/.test(tok)) weather = 'clear'
    else if (/^exams?$/.test(tok)) event = 'exam_week'
    else if (/^(game|gameday|home_game)$/.test(tok)) event = 'home_game'
    else if (/^(move-in|movein|move_in)$/.test(tok)) event = 'move_in'
    else {
      const d = DAYS.find((x) => tok.length >= 3 && x.toLowerCase().startsWith(tok))
      if (d) day = d
    }
  }
  if (target === null) {
    const now = current ? (metric === 'orders' ? current.orders.p50 : current.revenue.p50) : metric === 'orders' ? 80 : 1200
    target = Math.round((now * 1.5) / (metric === 'orders' ? 10 : 100)) * (metric === 'orders' ? 10 : 100)
  }
  return { metric, target, scenario: { day, weather, event, runs: 20 } }
}

/* ───────────── run ───────────── */

function fold(runId: string, turnId: string, e: AgentEvent) {
  const o = 'optimize' in e ? e.optimize : undefined
  switch (e.type) {
    case 'thinking':
      if (!o || o.round === 0 || o.final) {
        if (o?.final && e.label === 'Checking') patchRun(runId, (r) => ({ ...r, checking: true }))
        return
      }
      if (e.label === 'Kept' && o.candidate !== undefined) {
        patchRound(runId, o.round, (r) => ({ ...r, kept: o.candidate!, settled: true }))
      } else if (e.label === 'Kept nothing') {
        patchRound(runId, o.round, (r) => ({ ...r, kept: null, settled: true }))
      } else {
        const plan = e.detail && e.detail !== 'Reading the objections' ? e.detail : null
        patchRound(runId, o.round, (r) => ({ ...r, plan: plan ?? r.plan }))
      }
      return
    case 'edits':
      if (o?.final && e.needsApproval) {
        const run = useOptimize.getState().runs[runId]
        if (!run) return
        // The owner approves the whole set with Lane A's approval card. Code applies it and makes a version.
        updateTurn(turnId, (blocks) => [
          ...blocks,
          {
            kind: 'edits',
            id: uid('b'),
            edits: e.edits,
            base: run.base,
            needsApproval: true,
            byHand: false,
            status: 'pending',
            selected: e.edits.map(() => true),
            version: null,
          },
        ])
        return
      }
      if (o && o.candidate !== undefined) {
        const c: Candidate = { index: o.candidate, title: o.title ?? 'Edit set', edits: e.edits, prediction: null }
        patchRound(runId, o.round, (r) => ({ ...r, candidates: [...r.candidates, c] }))
      }
      return
    case 'prediction':
      if (!o) return
      if (o.final) patchRun(runId, (r) => ({ ...r, final: e.prediction, checking: false }))
      else if (o.round === 0) patchRun(runId, (r) => ({ ...r, start: e.prediction }))
      else if (o.candidate !== undefined)
        patchRound(runId, o.round, (r) => ({
          ...r,
          candidates: r.candidates.map((c) => (c.index === o.candidate ? { ...c, prediction: e.prediction } : c)),
        }))
      return
    case 'error':
      patchRun(runId, (r) => ({ ...r, error: e.message }))
      return
    default:
      return
  }
}

export async function runOptimize(args: string) {
  const mise = useMise.getState()
  const text = `/optimize${args ? ` ${args}` : ''}`
  const turnId = startTurn(text)
  const base = mise.concept
  if (!base) {
    updateTurn(turnId, (b) => [...b, { kind: 'error', id: uid('b'), message: 'No concept yet' }], { done: true })
    useSession.setState({ busy: false })
    return
  }
  const current = mise.prediction && mise.prediction.conceptVersion === base.version ? mise.prediction : null
  const goal = parseGoal(args, mise.scenario, current)
  // The right pane shows the goal's day, so the approved version is simulated on the same day.
  const s = mise.scenario
  if (s.day !== goal.scenario.day || s.weather !== goal.scenario.weather || s.event !== goal.scenario.event)
    runScenario({ day: goal.scenario.day, weather: goal.scenario.weather, event: goal.scenario.event })

  const headVersion = Math.max(0, ...mise.versions.map((v) => v.concept.version))
  const concept = { ...base, version: headVersion }
  const runId = uid('opt')
  useOptimize.setState((st) => ({
    runs: {
      ...st.runs,
      [runId]: { id: runId, goal, base: concept, startedAt: Date.now(), endedAt: null, start: null, rounds: [], checking: false, final: null, error: null },
    },
  }))
  updateTurn(turnId, (b) => [...b, { kind: 'optimize', id: uid('b'), runId }])

  try {
    await api.agentOptimize({ concept, goal }, (e) => fold(runId, turnId, e))
  } catch (err) {
    patchRun(runId, (r) => ({ ...r, error: err instanceof Error ? err.message : String(err) }))
  } finally {
    patchRun(runId, (r) => ({
      ...r,
      endedAt: Date.now(),
      checking: false,
      rounds: r.rounds.map((x) => ({ ...x, settled: true })),
    }))
    updateTurn(turnId, (b) => b, { done: true })
    useSession.setState({ busy: false })
  }
}
