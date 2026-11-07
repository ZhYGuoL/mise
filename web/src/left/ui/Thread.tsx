import type { ConceptEdit } from '@mise/shared'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/atoms/Button'
import { approve, skip, toggleEdit } from '../client'
import { OptimizeRun } from '../optimize'
import { editLabel, formatValue } from '../format'
import { type Block, type Turn, useSession } from '../session'

/* Beautiful UI thread: thinking-state steps, streaming text, tool-chips rows, diff-table approval. */

const ENTER = { animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }
const int = (n: number) => Math.round(n).toLocaleString('en-US')

const Icon = {
  spark: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  hand: <g><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></g>,
  city: <g><path d="M3 21h18M5 21V8l6-4v17M19 21V11l-8-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" /></g>,
  image: <g><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></g>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6L9 17l-5-5" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  alert: <g><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></g>,
}

function Svg({ children, size = 13, fill = false }: { children: ReactNode; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {children}
    </svg>
  )
}

const Spinner = () => (
  <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: 'spin 700ms linear infinite' }} />
)

/** One tool-chips row: icon, label, chip. */
function Row({ icon, label, chip, mono, right, busy }: { icon: ReactNode; label: string; chip?: ReactNode; mono?: boolean; right?: ReactNode; busy?: boolean }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2" style={ENTER}>
      <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">{busy ? <Spinner /> : icon}</span>
      <span className="shrink-0 text-[12.5px] font-medium text-ink">{label}</span>
      {chip !== undefined && (
        <span className={`inline-flex h-5.5 min-w-0 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline ${mono ? 'font-mono' : ''}`}>
          {chip}
        </span>
      )}
      {right && <span className="ml-auto flex shrink-0 items-center gap-1.5">{right}</span>}
    </div>
  )
}

function Steps({ b }: { b: Extract<Block, { kind: 'steps' }> }) {
  const working = b.endedAt === null
  const [manual, setManual] = useState<boolean | null>(null)
  const expanded = manual ?? working
  const secs = b.endedAt === null ? 0 : Math.max(1, Math.round((b.endedAt - b.startedAt) / 1000))
  return (
    <div className="flex flex-col" style={ENTER}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        <span style={{ color: working ? 'var(--ink-2)' : 'var(--ink-3)' }}>
          <Svg size={14} fill>{Icon.spark}</Svg>
        </span>
        {working ? (
          // Beautiful UI ThinkingState shimmer: a light band sweeps the label while the agent works.
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage: 'linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer-text 1.4s linear infinite',
            }}
          >
            Working
          </span>
        ) : (
          <span className="text-[13px] font-medium whitespace-nowrap text-ink-2" style={{ animation: 'fade-in 350ms ease-out both' }}>
            Worked for {secs}s
          </span>
        )}
        <span className="text-ink-3 transition-transform duration-200" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}>
          <Svg size={13}>{Icon.chevron}</Svg>
        </span>
      </button>
      {expanded && (
        <div className="relative mt-0.5 ml-[5px] border-l border-line pl-3.5">
          {b.steps.map((s, i) => {
            const current = working && i === b.steps.length - 1
            return (
              <div key={i} className="flex min-h-7 min-w-0 items-center gap-2" style={ENTER}>
                <span className="flex size-[13px] shrink-0 items-center justify-center text-ink-3">
                  {current ? <Spinner /> : <Svg size={13}>{Icon.check}</Svg>}
                </span>
                <span className="shrink-0 text-[12.5px] font-medium text-ink">{s.label}</span>
                {s.detail && <span className="min-w-0 truncate text-[12px] text-ink-3">{s.detail}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Text({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <p className="text-[13px] leading-relaxed text-pretty text-ink" style={ENTER}>
      {text}
      {streaming && <span className="stream-caret is-streaming" />}
    </p>
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

/** Edits that applied at once, as tool-chips rows. Click a row for the reason. */
function EditRows({ b }: { b: Extract<Block, { kind: 'edits' }> }) {
  const [open, setOpen] = useState<number | null>(null)
  const header = b.byHand ? 'Edited by hand' : b.edits.length === 1 ? '1 edit' : `${b.edits.length} edits`
  return (
    <div className="flex flex-col gap-0.5" style={ENTER}>
      <Row
        icon={<Svg>{b.byHand ? Icon.hand : Icon.write}</Svg>}
        label={header}
        busy={b.status === 'applying'}
        right={
          b.version !== null ? (
            <span className="rounded-chip bg-inset px-1.5 py-0.5 font-mono text-[11px] text-ink-2 shadow-hairline">v{b.version}</span>
          ) : b.status === 'failed' ? (
            <span className="text-[12px] text-red">Rejected</span>
          ) : null
        }
      />
      <div className="ml-2 flex flex-col border-l border-line pl-3.5">
        {b.edits.map((e, i) => (
          <div key={i}>
            <button
              type="button"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              disabled={!e.reason}
              className="-mx-1.5 flex h-7 w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-control px-1.5 text-left text-[12px] transition-colors duration-100 enabled:hover:bg-hover-2"
            >
              <span className="shrink-0 text-ink-2">{editLabel(e, b.base)}</span>
              <span className="inline-flex h-5.5 min-w-0 items-center rounded-chip bg-surface px-1.5 text-[11.5px] shadow-btn">
                <Change e={e} />
              </span>
            </button>
            {open === i && e.reason && <p className="pb-1 pl-0 text-[12px] leading-snug text-ink-3">{e.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Diff-table approval card: each changed row toggles, then one yes applies the kept ones. */
function Approval({ b }: { b: Extract<Block, { kind: 'edits' }> }) {
  const kept = b.selected.filter(Boolean).length
  const open = b.status === 'pending'
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-hairline" style={ENTER}>
      <div className="primitive-card-bar flex items-center justify-between border-b border-line">
        <span className="text-[12.5px] font-medium text-ink">
          {b.edits.length === 1 ? 'Apply this edit?' : `Apply ${b.edits.length} edits?`}
        </span>
      </div>
      <div className="flex flex-col">
        {b.edits.map((e, i) => {
          const on = b.selected[i]
          return (
            <div
              key={i}
              role="checkbox"
              aria-checked={on}
              tabIndex={open ? 0 : -1}
              onClick={open ? () => toggleEdit(b.id, i) : undefined}
              onKeyDown={
                open
                  ? (ev) => {
                      if (ev.key === ' ' || ev.key === 'Enter') {
                        ev.preventDefault()
                        toggleEdit(b.id, i)
                      }
                    }
                  : undefined
              }
              className={`flex gap-2.5 border-b border-line px-3 py-2.5 transition-[background-color,opacity] duration-150 last:border-0 ${open ? 'cursor-pointer hover:bg-hover' : ''}`}
              style={{ opacity: on ? 1 : 0.5 }}
            >
              <span
                aria-hidden
                className={`mt-px flex size-4.5 shrink-0 items-center justify-center rounded-[5px] transition-[background-color,transform] duration-150 ${on ? 'bg-ink text-surface' : 'bg-inset text-transparent shadow-hairline'}`}
                style={{ transform: on ? 'scale(1)' : 'scale(0.92)' }}
              >
                <Svg size={11}>{Icon.check}</Svg>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink">{editLabel(e, b.base)}</span>
                  <span className="shrink-0 text-[12.5px]">
                    <Change e={e} />
                  </span>
                </div>
                {e.reason && <p className="text-[12px] leading-snug text-pretty text-ink-2">{e.reason}</p>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="primitive-card-footer flex min-h-11 items-center justify-between border-t border-line">
        {b.status === 'applied' ? (
          <Pill tone="green">Applied as v{b.version}</Pill>
        ) : b.status === 'skipped' ? (
          <span className="pl-1 text-[12.5px] text-ink-3">Skipped</span>
        ) : b.status === 'failed' ? (
          <span className="pl-1 text-[12.5px] text-red">Rejected</span>
        ) : (
          <>
            <span className="pl-1 text-[11.5px] tabular-nums text-ink-3">
              {kept} of {b.edits.length} selected
            </span>
            <span className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" disabled={!open} onClick={() => skip(b.id)}>
                Skip
              </Button>
              <Button variant="primary" size="sm" disabled={!open || kept === 0} onClick={() => void approve(b.id)}>
                {b.status === 'applying' ? 'Applying' : `Apply ${kept}`}
              </Button>
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'green'; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[12.5px] font-medium ${tone === 'green' ? 'bg-green-tint text-green' : ''}`}
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <span className="flex size-4.5 items-center justify-center rounded-full bg-green text-white">
        <Svg size={11}>{Icon.check}</Svg>
      </span>
      {children}
    </span>
  )
}

function Sim({ b }: { b: Extract<Block, { kind: 'sim' }> }) {
  const p = b.prediction
  const delta = p && b.before !== null ? Math.round(p.orders.p50 - b.before) : null
  const label = `${b.scenario.day}${b.scenario.weather !== 'clear' ? `, ${b.scenario.weather}` : ''}${b.scenario.event !== 'none' ? `, ${b.scenario.event.replace('_', ' ')}` : ''}`
  return (
    <Row
      icon={<Svg>{Icon.city}</Svg>}
      busy={!p}
      label={p ? label : `Simulating ${label}`}
      chip={p ? <span className="tabular-nums">{int(p.orders.p10)} to {int(p.orders.p90)} orders</span> : undefined}
      right={
        p && (
          <>
            <span className="text-[12px] tabular-nums text-ink-2">p50 {int(p.orders.p50)}</span>
            {delta !== null && delta !== 0 && (
              <span
                className={`rounded-chip px-1.5 py-0.5 text-[11.5px] font-medium tabular-nums ${delta > 0 ? 'bg-green-tint text-green' : 'bg-red-tint text-red'}`}
                style={{ animation: 'pop-in 220ms cubic-bezier(0.23,1,0.32,1) both' }}
              >
                {delta > 0 ? '+' : '−'}
                {Math.abs(delta)}
              </span>
            )}
          </>
        )
      }
    />
  )
}

function Photos({ b }: { b: Extract<Block, { kind: 'photos' }> }) {
  const all = Object.values(b.targets)
  const done = all.filter((s) => s === 'done').length
  const running = !b.closed && done < all.length
  return <Row icon={<Svg>{Icon.image}</Svg>} busy={running} label="Photos" chip={<span className="tabular-nums">{done} of {all.length}</span>} />
}

function BlockView({ b, streaming }: { b: Block; streaming: boolean }) {
  switch (b.kind) {
    case 'steps':
      return <Steps b={b} />
    case 'text':
      return <Text text={b.text} streaming={streaming} />
    case 'created':
      return <Row icon={<Svg>{Icon.plus}</Svg>} label="Created" chip={b.name} right={<span className="rounded-chip bg-inset px-1.5 py-0.5 font-mono text-[11px] text-ink-2 shadow-hairline">v{b.version}</span>} />
    case 'edits':
      return b.needsApproval ? <Approval b={b} /> : <EditRows b={b} />
    case 'photos':
      return <Photos b={b} />
    case 'sim':
      return <Sim b={b} />
    case 'optimize':
      return <OptimizeRun runId={b.runId} />
    case 'error':
      return (
        <div className="flex items-start gap-2 rounded-control bg-red-tint px-2.5 py-2 text-[12.5px] text-red" style={ENTER}>
          <Svg size={14}>{Icon.alert}</Svg>
          <span className="min-w-0 break-words">{b.message}</span>
        </div>
      )
  }
}

function TurnView({ t }: { t: Turn }) {
  if (t.role === 'user') {
    return (
      <div className="flex justify-end pl-14" style={ENTER}>
        <div className="rounded-xl bg-field px-3 py-1.5 text-[13px] leading-[1.45] text-ink">{t.text}</div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {t.blocks.map((b, i) => (
        <BlockView key={b.id} b={b} streaming={!t.done && i === t.blocks.length - 1} />
      ))}
    </div>
  )
}

export function Thread() {
  const turns = useSession((s) => s.turns)
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [turns])

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-3"
    >
      {turns.map((t) => (
        <TurnView key={t.id} t={t} />
      ))}
    </div>
  )
}
