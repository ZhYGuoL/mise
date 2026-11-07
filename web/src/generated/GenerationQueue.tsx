import type { Concept } from '@mise/shared'
import { seconds, useElapsed } from './motion'
import { CheckIcon, RetryIcon, XIcon } from './parts'
import { type GenTask, taskKey, useGeneration } from './store'

/* Beautiful UI task-rows (List variant), driven by real generation state instead of its demo clock. */

function SpinnerRing({ active }: { active: boolean }) {
  const size = 22
  const stroke = 2
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg
      width={size}
      height={size}
      aria-hidden
      style={active ? { animation: 'spin 1.1s linear infinite' } : undefined}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} />
      {active && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * 0.28} ${c * 0.72}`}
        />
      )}
    </svg>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  return (
    <span
      className={`flex size-5.5 items-center justify-center rounded-full text-white ${tone === 'red' ? 'bg-red' : 'bg-green'}`}
      style={{ animation: 'pop-in 300ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      {children}
    </span>
  )
}

function Pill({ tone, children }: { tone: 'green' | 'red' | 'neutral'; children: React.ReactNode }) {
  const cls =
    tone === 'green' ? 'bg-green-tint text-green' : tone === 'red' ? 'bg-red-tint text-red' : 'bg-inset text-ink-3'
  return (
    <span
      className={`inline-flex h-5.5 items-center rounded-full px-2 text-[11.5px] font-medium ${cls}`}
      style={{ animation: 'fade-in 200ms ease-out both' }}
    >
      {children}
    </span>
  )
}

function Row({ label, task, onRegenerate }: { label: string; task: GenTask | undefined; onRegenerate: () => void }) {
  const status = task?.status
  const running = status === 'generating'
  const elapsed = useElapsed(task?.startedAt ?? 0, running)

  const meta = running
    ? seconds(elapsed)
    : task?.serverStatus === 'cached'
      ? 'Cached'
      : task?.ms != null && status === 'done'
        ? seconds(task.ms / 1000)
        : ''

  return (
    <li className="flex h-11 items-center gap-2.5 border-b border-line px-2.5 last:border-0">
      <span className="flex size-6 shrink-0 items-center justify-center">
        {status === 'done' ? (
          <Badge tone="green"><CheckIcon /></Badge>
        ) : status === 'failed' ? (
          <Badge tone="red"><XIcon /></Badge>
        ) : (
          <SpinnerRing active={running} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{label}</span>
      <span className="font-mono text-[11.5px] text-ink-3 tabular-nums">{meta}</span>
      {status === 'done' && <Pill tone="green">Done</Pill>}
      {status === 'failed' && <Pill tone="red">Failed</Pill>}
      {status === 'off' && <Pill tone="neutral">Off</Pill>}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={running || status === 'off'}
        aria-label={status === 'failed' ? `Retry ${label}` : `Regenerate ${label}`}
        title={status === 'failed' ? 'Retry' : 'Regenerate'}
        className="-mr-1 grid size-7 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-[80ms]
          hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-0"
      >
        <RetryIcon />
      </button>
    </li>
  )
}

/** One row per image target: the logo, then each dish. */
export function GenerationQueue({ concept, className = '' }: { concept: Concept; className?: string }) {
  const tasks = useGeneration((s) => s.tasks)
  const regenerate = useGeneration((s) => s.regenerate)
  const targets = [
    { target: 'logo', label: 'Logo' },
    ...concept.menu.map((m) => ({ target: m.id, label: m.name })),
  ]
  const done = targets.filter((t) => tasks[taskKey(concept.id, t.target)]?.status === 'done').length

  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      <header className="flex items-baseline justify-between px-0.5">
        <h3 className="text-[13px] font-medium text-ink">Images</h3>
        <span className="text-[12.5px] text-ink-2 tabular-nums">
          {done} of {targets.length}
        </span>
      </header>
      <ul className="overflow-hidden rounded-card border border-line bg-surface">
        {targets.map((t) => (
          <Row
            key={t.target}
            label={t.label}
            task={tasks[taskKey(concept.id, t.target)]}
            onRegenerate={() => regenerate(concept, t.target)}
          />
        ))}
      </ul>
    </section>
  )
}
