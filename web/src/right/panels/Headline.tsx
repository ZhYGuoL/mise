import type { Prediction } from '@mise/shared'
import { AnimatePresence, motion } from 'motion/react'
import type { Baseline } from '../lib/data'
import { int, pct1, signed, usd, usdCents } from '../lib/format'
import { spring } from '../lib/motion'

type Cell = {
  title: string
  value: string
  range: string | null
  /** change vs the previous version, already formatted, or null */
  delta: { text: string; up: boolean } | null
}

function delta(now: number, before: number | undefined, format: (abs: number) => string) {
  if (before === undefined) return null
  const text = signed(now - before, format)
  return text ? { text, up: now > before } : null
}

function cells(p: Prediction, base: Prediction | undefined): Cell[] {
  return [
    {
      title: 'Orders',
      value: int(p.orders.p50),
      range: `${int(p.orders.p10)} to ${int(p.orders.p90)}`,
      delta: delta(p.orders.p50, base?.orders.p50, int),
    },
    {
      title: 'Revenue',
      value: usd(p.revenue.p50),
      range: `${usd(p.revenue.p10)} to ${usd(p.revenue.p90)}`,
      delta: delta(p.revenue.p50, base?.revenue.p50, usd),
    },
    {
      title: 'Avg ticket',
      value: usdCents(p.avgTicket),
      range: null,
      delta: delta(p.avgTicket, base?.avgTicket, usdCents),
    },
    {
      title: 'Market share',
      value: pct1(p.marketSharePct),
      range: null,
      delta: delta(p.marketSharePct, base?.marketSharePct, (n) => `${n.toFixed(1)} pts`),
    },
  ]
}

/** The four numbers that matter, with the change from the previous concept version. */
export function Headline({ prediction, baseline, busy }: { prediction: Prediction; baseline: Baseline | null; busy: boolean }) {
  return (
    <div
      className="grid grid-cols-4 divide-x divide-line overflow-hidden rounded-card bg-surface shadow-hairline transition-opacity duration-150"
      style={{ opacity: busy ? 0.45 : 1 }}
      aria-busy={busy}
    >
      {cells(prediction, baseline?.prediction).map((c) => (
        <div key={c.title} className="flex min-w-0 flex-col gap-1.5 px-4 pt-3 pb-3.5">
          <div className="flex h-5 items-center justify-between gap-2">
            <span className="truncate text-[13px] text-ink-2">{c.title}</span>
            <AnimatePresence mode="popLayout" initial={false}>
              {c.delta && baseline && (
                <motion.span
                  key={`${baseline.version}:${c.delta.text}`}
                  aria-label={`${c.delta.text} vs v${baseline.version}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={spring.moderate}
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11.5px] leading-none font-medium whitespace-nowrap tabular-nums ${
                    c.delta.up ? 'bg-green-tint text-green' : 'bg-red-tint text-red'
                  }`}
                >
                  {c.delta.text}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {c.value}
          </span>
          <span className="h-4 text-[12.5px] leading-4 text-ink-3 tabular-nums">{c.range}</span>
        </div>
      ))}
    </div>
  )
}
