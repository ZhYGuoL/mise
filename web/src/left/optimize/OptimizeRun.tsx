import type { Concept, ConceptEdit, OptimizeGoal } from '@mise/shared'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { editLabel, formatValue } from '../format'
import { bandOf, metricOf, useOptimize, type Candidate, type Round, type Run } from './run'
import './optimize.css'

/* Wave 2: one optimize run in the thread. Goal header, progress toward the target, one block per round. */

const ENTER = { animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }
const MAX_ROUNDS = 5

const fmt = (goal: OptimizeGoal, n: number) =>
  goal.metric === 'orders' ? Math.round(n).toLocaleString('en-US') : `$${Math.round(n).toLocaleString('en-US')}`
const unit = (goal: OptimizeGoal) => (goal.metric === 'orders' ? 'orders' : 'revenue')

const Spinner = () => (
  <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: 'spin 700ms linear infinite' }} />
)

function Svg({ children, size = 13 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {children}
    </svg>
  )
}

const Icon = {
  target: <g><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></g>,
  check: <path d="M20 6L9 17l-5-5" />,
  dot: <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />,
  chevron: <path d="M6 9l6 6 6-6" />,
}

function Delta({ value, goal }: { value: number; goal: OptimizeGoal }) {
  const v = Math.round(value)
  if (v === 0) return <span className="w-10 text-right text-[11.5px] tabular-nums text-ink-3">0</span>
  return (
    <span
      className={`rounded-chip px-1.5 py-0.5 text-[11.5px] font-medium tabular-nums ${v > 0 ? 'bg-green-tint text-green' : 'bg-red-tint text-red'}`}
      style={{ animation: 'pop-in 220ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      {v > 0 ? '+' : '−'}
      {goal.metric === 'revenue' ? '$' : ''}
      {Math.abs(v).toLocaleString('en-US')}
    </span>
  )
}

function Change({ e }: { e: ConceptEdit }) {
  const before = formatValue(e.path, e.previous)
  const after = formatValue(e.path, e.value)
  return (
    <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
      {e.op !== 'add' && <span className="min-w-0 truncate text-red line-through decoration-red/50">{before}</span>}
      {e.op === 'replace' && <span className="shrink-0 text-ink-3">→</span>}
      {e.op !== 'remove' && <span className="min-w-0 truncate text-green">{after}</span>}
    </span>
  )
}

/* ───────────── progress chart ───────────── */

/** p50 of every set the loop ran, by round. The kept path steps toward the target line. */
function Progress({ run }: { run: Run }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { goal } = run
  const H = 104
  const top = 10
  const bottom = 18
  const left = 4
  const right = 34
  const start = run.start ? metricOf(goal, run.start) : null
  const seen = run.rounds.flatMap((r) => r.candidates.flatMap((c) => (c.prediction ? [metricOf(goal, c.prediction)] : [])))
  const hi = Math.max(goal.target * 1.15, ...seen.map((v) => v * 1.05), start ?? 0)
  const y = (v: number) => top + (1 - v / hi) * (H - top - bottom)
  const cols = MAX_ROUNDS + 1
  const x = (round: number) => left + ((w - left - right) * round) / (cols - 1)
  /** Sets in one round sit side by side, so close results do not hide each other. */
  const xc = (round: number, i: number, n: number) => x(round) + (i - (n - 1) / 2) * 8

  // The kept path: start, then each round's kept set, flat when a round kept nothing.
  const path: { round: number; v: number; px: number }[] = []
  if (start !== null) path.push({ round: 0, v: start, px: x(0) })
  for (const r of run.rounds) {
    if (!r.settled) continue
    const i = r.candidates.findIndex((c) => c.index === r.kept)
    const k = i >= 0 ? r.candidates[i].prediction : null
    const prev = path.at(-1)?.v ?? start ?? 0
    path.push({ round: r.round, v: k ? metricOf(goal, k) : prev, px: k ? xc(r.round, i, r.candidates.length) : x(r.round) })
  }
  const latest = path.at(-1)?.v ?? null
  const reached = latest !== null && latest >= goal.target
  const ty = y(goal.target)

  return (
    <div ref={ref} className="relative rounded-card bg-surface px-3 pt-2 pb-1 shadow-hairline">
      {w > 0 && (
        <svg width={w - 24} height={H} className="block overflow-visible" role="img" aria-label={`${unit(goal)} by round`}>
          {/* target */}
          <line x1={left} x2={w - 24 - right + 6} y1={ty} y2={ty} stroke={reached ? 'var(--green)' : 'var(--ink-3)'} strokeWidth={1} strokeDasharray="3 3" style={{ transition: 'stroke 300ms' }} />
          <text x={w - 24 - right + 10} y={ty + 3.5} fontSize={11} className="tabular-nums" fill={reached ? 'var(--green)' : 'var(--ink-2)'} style={{ fontWeight: 500 }}>
            {fmt(goal, goal.target)}
          </text>
          {/* round ticks */}
          {Array.from({ length: cols }, (_, i) => (
            <text key={i} x={x(i)} y={H - 3} fontSize={10.5} textAnchor={i === 0 ? 'start' : 'middle'} fill="var(--ink-3)" className="tabular-nums">
              {i === 0 ? 'Start' : i}
            </text>
          ))}
          {/* every set that ran */}
          {run.rounds.flatMap((r) =>
            r.candidates.map((c, i) => {
              if (!c.prediction) return null
              const cx = xc(r.round, i, r.candidates.length)
              const cy = y(metricOf(goal, c.prediction))
              return (
                <circle
                  key={`${r.round}-${c.index}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill="var(--line-strong)"
                  stroke="var(--ink-3)"
                  strokeWidth={1}
                  style={{ animation: 'pop-in 220ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: `${cx}px ${cy}px` }}
                />
              )
            }),
          )}
          {/* kept path */}
          {path.slice(1).map((p, i) => {
            const a = path[i]
            const len = Math.hypot(p.px - a.px, y(p.v) - y(a.v))
            return (
              <line
                key={`seg-${p.round}`}
                x1={a.px}
                y1={y(a.v)}
                x2={p.px}
                y2={y(p.v)}
                stroke="var(--ink)"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeDasharray={len}
                style={{ ['--len' as string]: len, animation: 'opt-draw 420ms cubic-bezier(0.23,1,0.32,1) both' }}
              />
            )
          })}
          {path.map((p) => (
            <g key={`kept-${p.round}`}>
              <circle
                cx={p.px}
                cy={y(p.v)}
                r={4}
                fill={p.v >= goal.target ? 'var(--green)' : 'var(--ink)'}
                stroke="var(--surface)"
                strokeWidth={1.5}
                style={{ animation: 'pop-in 220ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: `${p.px}px ${y(p.v)}px` }}
              />
              <text x={p.px} y={y(p.v) - 8} fontSize={11} textAnchor={p.round === 0 ? 'start' : 'middle'} fill="var(--ink)" className="tabular-nums" style={{ fontWeight: 500, animation: 'fade-in 300ms ease-out both' }}>
                {fmt(goal, p.v)}
              </text>
            </g>
          ))}
        </svg>
      )}
      {w === 0 && <div style={{ height: H }} />}
    </div>
  )
}

/* ───────────── rounds ───────────── */

function CandidateRow({ c, base, goal, before, kept, settled, open, onToggle }: {
  c: Candidate
  /** the concept the edit paths point into. The run's start is close enough for later rounds. */
  base: Concept
  goal: OptimizeGoal
  before: number | null
  kept: boolean
  settled: boolean
  open: boolean
  onToggle: () => void
}) {
  const p = c.prediction
  const band = p ? bandOf(goal, p) : null
  return (
    <div style={ENTER}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-mx-1.5 flex h-7 w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-control px-1.5 text-left transition-colors duration-100 hover:bg-hover-2"
      >
        <span className={`flex size-4 shrink-0 items-center justify-center ${kept ? 'text-green' : 'text-ink-3'}`}>
          {!p ? <Spinner /> : kept ? <Svg size={13}>{Icon.check}</Svg> : <Svg size={13}>{Icon.dot}</Svg>}
        </span>
        <span className={`min-w-0 truncate text-[12.5px] ${kept ? 'font-medium text-ink' : settled ? 'text-ink-2' : 'text-ink'}`}>{c.title}</span>
        <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums">
          {c.edits.length} {c.edits.length === 1 ? 'edit' : 'edits'}
        </span>
        {p && band && (
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-[11.5px] text-ink-3 tabular-nums">
              {fmt(goal, band.p10)} to {fmt(goal, band.p90)}
            </span>
            <span className="w-9 text-right text-[12px] text-ink tabular-nums">{fmt(goal, metricOf(goal, p))}</span>
            {before !== null && <Delta value={metricOf(goal, p) - before} goal={goal} />}
          </span>
        )}
      </button>
      {open && (
        <div className="mb-1 ml-2 flex flex-col border-l border-line pl-3.5">
          {c.edits.map((e, i) => (
            <div key={i} className="flex min-h-6 min-w-0 flex-col justify-center py-0.5">
              <span className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className="shrink-0 text-ink-2">{editLabel(e, base)}</span>
                <span className="inline-flex h-5.5 min-w-0 items-center rounded-chip bg-surface px-1.5 text-[11.5px] shadow-btn">
                  <Change e={e} />
                </span>
              </span>
              {e.reason && <span className="pt-0.5 text-[11.5px] leading-snug text-ink-3">{e.reason}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RoundView({ r, base, goal, before, last }: { r: Round; base: Concept; goal: OptimizeGoal; before: number | null; last: boolean }) {
  const [openSet, setOpen] = useState<number | null | undefined>(undefined)
  // The kept set shows its edits until the owner picks another row.
  const open = openSet === undefined ? r.kept : openSet
  const keptPred = r.kept !== null ? r.candidates.find((c) => c.index === r.kept)?.prediction : null
  const running = !r.settled && last
  return (
    <div className="flex flex-col" style={ENTER}>
      <div className="flex h-7 items-center gap-2">
        <span className="text-[12.5px] font-medium text-ink">Round {r.round}</span>
        {running && <Spinner />}
        <span className="ml-auto flex items-center gap-1.5 text-[12px] tabular-nums">
          {r.settled && before !== null && (
            keptPred ? (
              <>
                <span className="text-ink-3">{fmt(goal, before)}</span>
                <span className="text-ink-3">→</span>
                <span className="font-medium text-ink">{fmt(goal, metricOf(goal, keptPred))}</span>
              </>
            ) : (
              <span className="text-ink-3">No gain</span>
            )
          )}
        </span>
      </div>
      {r.plan && <p className="pb-1 text-[12px] leading-snug text-pretty text-ink-3">{r.plan}</p>}
      <div className="ml-[3px] flex flex-col">
        {r.candidates.map((c) => (
          <CandidateRow
            key={c.index}
            c={c}
            base={base}
            goal={goal}
            before={before}
            kept={r.kept === c.index}
            settled={r.settled}
            open={open === c.index}
            onToggle={() => setOpen(open === c.index ? null : c.index)}
          />
        ))}
        {r.candidates.length === 0 && !r.settled && (
          <div className="flex h-7 items-center gap-2 text-[12.5px] text-ink-3">
            <span className="flex size-4 items-center justify-center"><Spinner /></span>
            Proposing
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────────── run ───────────── */

function useElapsed(startedAt: number, endedAt: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (endedAt !== null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [endedAt])
  return Math.max(0, Math.round(((endedAt ?? now) - startedAt) / 1000))
}

function Final({ run }: { run: Run }) {
  const { goal, final } = run
  if (run.checking)
    return (
      <div className="flex h-7 items-center gap-2 text-[12.5px]" style={ENTER}>
        <span className="flex size-4 items-center justify-center"><Spinner /></span>
        <span className="font-medium text-ink">Checking</span>
        <span className="text-ink-3 tabular-nums">{goal.scenario.runs} runs</span>
      </div>
    )
  if (!final) return null
  const band = bandOf(goal, final)
  const reached = metricOf(goal, final) >= goal.target
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3 py-2.5 shadow-hairline" style={ENTER}>
      <div className="flex min-w-0 flex-col">
        <span className={`text-[11.5px] font-medium ${reached ? 'text-green' : 'text-ink-2'}`}>{reached ? 'Reached' : 'Closest'}</span>
        <span className="flex items-baseline gap-1.5 tabular-nums">
          <span className="text-[20px] leading-tight font-semibold text-ink">{fmt(goal, band.p50)}</span>
          <span className="text-[12px] text-ink-2">{unit(goal)}</span>
        </span>
      </div>
      <div className="ml-auto flex flex-col items-end text-[12px] tabular-nums">
        <span className="text-ink-2">
          p10 to p90 {fmt(goal, band.p10)} to {fmt(goal, band.p90)}
        </span>
        <span className="text-ink-3">
          {goal.metric === 'orders' ? `$${Math.round(final.revenue.p50).toLocaleString('en-US')} revenue` : `${Math.round(final.orders.p50)} orders`} · {final.scenario.runs} runs
        </span>
      </div>
    </div>
  )
}

export function OptimizeRun({ runId }: { runId: string }) {
  const run = useOptimize((s) => s.runs[runId])
  const secs = useElapsed(run?.startedAt ?? 0, run ? run.endedAt : 0)
  if (!run) return null
  const { goal } = run
  const working = run.endedAt === null
  const last = run.rounds.at(-1)
  const status = working
    ? run.checking || run.final
      ? 'Checking'
      : last
        ? `Round ${last.round}`
        : 'Starting'
    : run.error
      ? 'Stopped'
      : run.final && metricOf(goal, run.final) >= goal.target
        ? 'Reached'
        : run.final
          ? 'Done'
          : 'No gain'

  // Each round compares against where it started: the start, or the last kept set.
  let before = run.start ? metricOf(goal, run.start) : null
  const befores: (number | null)[] = []
  for (const r of run.rounds) {
    befores.push(before)
    const k = r.kept !== null ? r.candidates.find((c) => c.index === r.kept)?.prediction : null
    if (k) before = metricOf(goal, k)
  }

  return (
    <div className="flex flex-col gap-2.5" style={ENTER}>
      <div className="flex h-7 min-w-0 items-center gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">
          <Svg size={14}>{Icon.target}</Svg>
        </span>
        <span className="shrink-0 text-[12.5px] font-medium text-ink">Optimize</span>
        <span className="inline-flex h-5.5 min-w-0 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline tabular-nums">
          {fmt(goal, goal.target)} {unit(goal)} · {goal.scenario.day}
          {goal.scenario.weather !== 'clear' ? ` · ${goal.scenario.weather}` : ''}
          {goal.scenario.event !== 'none' ? ` · ${goal.scenario.event.replace('_', ' ')}` : ''}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums">
          {working && <Spinner />}
          <span className={status === 'Reached' ? 'font-medium text-green' : status === 'Stopped' ? 'text-red' : 'text-ink-2'}>{status}</span>
          <span className="text-ink-3">{secs}s</span>
        </span>
      </div>

      <Progress run={run} />

      <div className="flex flex-col gap-2">
        {run.rounds.map((r, i) => (
          <RoundView key={r.round} r={r} base={run.base} goal={goal} before={befores[i]} last={i === run.rounds.length - 1} />
        ))}
      </div>

      <Final run={run} />

      {run.error && (
        <div className="rounded-control bg-red-tint px-2.5 py-2 text-[12.5px] text-red" style={ENTER}>
          {run.error}
        </div>
      )}
    </div>
  )
}
