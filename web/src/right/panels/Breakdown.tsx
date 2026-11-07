import type { Concept, Prediction, Resident } from '@mise/shared'
import { motion } from 'motion/react'
import type { Flow } from '../lib/flows'
import { SEGMENT_LABEL, SEGMENT_ONE, int } from '../lib/format'
import { spring } from '../lib/motion'
import { clockLabel } from '../lib/time'

function Card({ title, children, busy }: { title: string; children: React.ReactNode; busy: boolean }) {
  return (
    <div
      className="flex min-w-0 flex-col rounded-card bg-surface p-3 shadow-hairline transition-opacity duration-150"
      style={{ opacity: busy ? 0.45 : 1 }}
    >
      <span className="px-0.5 text-[13px] font-semibold text-ink">{title}</span>
      <div className="mt-2.5 flex flex-col gap-2.5">{children}</div>
    </div>
  )
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-field">
      <motion.span
        className="block h-full origin-left rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ scaleX: max > 0 ? value / max : 0 }}
        transition={spring.slow}
      />
    </span>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Objections, most common first. Bars share one scale, the top reason fills the track. */
export function Objections({ prediction, busy }: { prediction: Prediction; busy: boolean }) {
  const rows = [...prediction.objections].sort((a, b) => b.pct - a.pct)
  const max = Math.max(...rows.map((r) => r.pct), 1)
  return (
    <Card title="Why people said no" busy={busy}>
      {rows.map((o) => (
        <div key={o.code} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-[12.5px] leading-snug">
            <span className="w-8 shrink-0 font-semibold text-ink tabular-nums">{Math.round(o.pct)}%</span>
            <span className="min-w-0 flex-1 truncate text-ink">{capitalize(o.label)}</span>
            {o.segment && <span className="shrink-0 text-[11.5px] text-ink-3">{SEGMENT_LABEL[o.segment]}</span>}
          </div>
          <div className="pl-10">
            <Bar value={o.pct} max={max} color="var(--ink-3)" />
          </div>
        </div>
      ))}
    </Card>
  )
}

/** Who ordered from the concept, by segment. */
export function WhoOrdered({ prediction, color, busy }: { prediction: Prediction; color: string; busy: boolean }) {
  const rows = [...prediction.bySegment].sort((a, b) => b.orders - a.orders)
  const max = Math.max(...rows.map((r) => r.orders), 1)
  return (
    <Card title="Who ordered" busy={busy}>
      {rows.map((s) => (
        <div key={s.segment} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-[12.5px] leading-snug">
            <span className="min-w-0 flex-1 truncate text-ink">{SEGMENT_LABEL[s.segment]}</span>
            <span className="font-semibold text-ink tabular-nums">{int(s.orders)}</span>
            <span className="w-10 text-right text-ink-3 tabular-nums">{Math.round(s.sharePct)}%</span>
          </div>
          <Bar value={s.orders} max={max} color={color} />
        </div>
      ))}
    </Card>
  )
}

/** The residents the simulation sampled. Clicking one selects it on the map. */
export function SampledResidents({
  residents,
  flowsByResident,
  concept,
  color,
  selectedId,
  onSelect,
  busy,
}: {
  residents: Resident[]
  flowsByResident: Map<string, Flow>
  concept: Concept
  color: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  busy: boolean
}) {
  if (residents.length === 0) return null
  return (
    <div className="rounded-card bg-surface p-3 shadow-hairline transition-opacity duration-150" style={{ opacity: busy ? 0.45 : 1 }}>
      <span className="px-0.5 text-[13px] font-semibold text-ink">Residents</span>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {residents.map((r) => {
          const flow = flowsByResident.get(r.id)
          const selected = r.id === selectedId
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : r.id)}
              className={`flex min-w-0 flex-col gap-0.5 rounded-control px-2.5 py-2 text-left transition-[background-color,box-shadow] duration-100 ${
                selected ? 'bg-inset shadow-[0_0_0_1.5px_var(--ink)]' : 'shadow-hairline hover:bg-hover'
              }`}
            >
              <span className="truncate text-[12.5px] font-medium text-ink">
                {r.name}, <span className="tabular-nums">{r.age}</span>
              </span>
              <span className="truncate text-[11.5px] text-ink-3">{SEGMENT_ONE[r.segment]}</span>
              <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: flow ? (flow.concept ? color : 'var(--ink-3)') : 'var(--line-strong)' }}
                />
                <span className="truncate">{flow ? (flow.concept ? concept.name : 'Elsewhere') : 'No order'}</span>
                {flow && <span className="ml-auto shrink-0 text-ink-3 tabular-nums">{clockLabel(flow.t)}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
