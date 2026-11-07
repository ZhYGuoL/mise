import type { ReactNode } from 'react'
import { useMise } from '@/state/store'

const int = (n: number) => Math.round(n).toLocaleString('en-US')
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function Stat({ title, value, range }: { title: string; value: ReactNode; range?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <span className="text-ink-2">{title}</span>
      <span className="text-[28px] leading-none font-semibold tabular-nums text-ink">{value}</span>
      {range && <span className="tabular-nums text-ink-3">{range}</span>}
    </div>
  )
}

/** Lane E owns this pane. Scaffold: headline numbers from the store's prediction. */
export function RightPane() {
  const prediction = useMise((s) => s.prediction)
  const simulating = useMise((s) => s.simulating)
  const scenario = useMise((s) => s.scenario)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium text-ink">{scenario.day}</h2>
        {simulating && <span className="text-ink-3">Simulating</span>}
      </div>
      {prediction && (
        <div className={`grid grid-cols-2 gap-3 ${simulating ? 'opacity-50' : ''}`}>
          <Stat
            title="Orders"
            value={int(prediction.orders.p50)}
            range={`${int(prediction.orders.p10)} to ${int(prediction.orders.p90)}`}
          />
          <Stat
            title="Revenue"
            value={usd(prediction.revenue.p50)}
            range={`${usd(prediction.revenue.p10)} to ${usd(prediction.revenue.p90)}`}
          />
          <Stat title="Avg ticket" value={`$${prediction.avgTicket.toFixed(2)}`} />
          <Stat title="Market share" value={`${prediction.marketSharePct.toFixed(1)}%`} />
        </div>
      )}
    </div>
  )
}
