import type { Concept, Prediction, Resident, Restaurant, Scenario } from '@mise/shared'
import { useCallback, useState } from 'react'
import { css, type RGB } from '../lib/color'
import { ordersSoFar, type Flow } from '../lib/flows'
import { usePlayhead } from '../lib/playhead'
import { DAY_MINUTES, clockLabel, openWindow } from '../lib/time'
import { CityMap } from './CityMap'
import { ResidentCard } from './ResidentCard'
import { TakenList } from './TakenList'
import { MapLoading, TimeBar } from './TimeBar'

/** Running order count and clock for the title row. Re-renders once per simulated minute. */
function Status({
  prediction,
  concept,
  color,
  busy,
}: {
  prediction: Prediction
  concept: Concept
  color: RGB
  busy: boolean
}) {
  const minute = usePlayhead((s) => Math.floor(s.t))
  const ended = minute >= DAY_MINUTES
  const open = openWindow(concept, prediction.scenario.day)
  const isOpen = open !== null && minute >= open[0] && minute < open[1]
  return (
    <span
      className="flex items-center gap-3 text-[11.5px] whitespace-nowrap text-ink-3 transition-opacity duration-150"
      style={{ opacity: busy ? 0.45 : 1 }}
    >
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: css(color) }} />
        <span className="font-medium text-ink tabular-nums">{ordersSoFar(prediction, minute)}</span>
        orders
      </span>
      <span className="flex items-center gap-1.5">
        {!ended && <span className="font-medium text-ink tabular-nums">{clockLabel(minute)}</span>}
        {ended ? 'End of day' : isOpen ? 'Open' : 'Closed'}
      </span>
    </span>
  )
}

/**
 * The simulated city as a dashboard card, built like "Orders by hour": a title row, the map as an
 * inset, then the time bar on the card's own surface. The customers-taken list joins the card when
 * the labels would overlap on the map.
 */
export function CityCard({
  concept,
  scenario,
  prediction,
  busy,
  color,
  restaurants,
  residents,
  flows,
  flowsByResident,
  selected,
  onSelectResident,
}: {
  concept: Concept
  scenario: Scenario
  prediction: Prediction | null
  busy: boolean
  color: RGB
  restaurants: Restaurant[] | null
  residents: Resident[]
  flows: Flow[]
  flowsByResident: Map<string, Flow>
  selected: Resident | null
  onSelectResident: (id: string | null) => void
}) {
  const [labelsFit, setLabelsFit] = useState(true)
  const [highlight, setHighlight] = useState<string | null>(null)
  const closeResident = useCallback(() => onSelectResident(null), [onSelectResident])
  const day = prediction?.scenario.day ?? scenario.day
  const selectedFlow = selected ? (flowsByResident.get(selected.id) ?? null) : null

  return (
    <div className="rounded-card bg-surface p-3 shadow-hairline">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <span className="text-[13px] font-semibold text-ink">{day} in the city</span>
        {prediction && <Status prediction={prediction} concept={concept} color={color} busy={busy} />}
      </div>

      <div className="relative mt-2 h-[clamp(300px,42vh,460px)] overflow-hidden rounded-control shadow-hairline">
        <CityMap
          concept={concept}
          color={color}
          restaurants={restaurants ?? []}
          residents={residents}
          flows={flows}
          stolen={prediction?.stolenFrom ?? []}
          selected={selected}
          selectedFlow={selectedFlow}
          highlight={labelsFit ? null : highlight}
          showLost={labelsFit}
          onSelectResident={onSelectResident}
          onLabelsFit={setLabelsFit}
        >
          {busy && <MapLoading />}
          {selected && restaurants && (
            <ResidentCard
              resident={selected}
              flow={selectedFlow}
              concept={concept}
              color={color}
              restaurants={restaurants}
              onClose={closeResident}
            />
          )}
        </CityMap>
      </div>

      <TimeBar prediction={prediction} color={color} />
      {prediction && !labelsFit && <TakenList stolen={prediction.stolenFrom} onHighlight={setHighlight} />}
    </div>
  )
}
