import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo } from 'react'
import { useMise } from '@/state/store'
import { conceptColor, css } from './lib/color'
import { useBaseline, useCity, useRunView, useSimulateNewVersions } from './lib/data'
import { buildFlows, type Flow } from './lib/flows'
import { usePlayhead, usePlayheadDriver } from './lib/playhead'
import { DAY_MINUTES, toDayMinutes } from './lib/time'
import { CityMap } from './map/CityMap'
import { ResidentCard } from './map/ResidentCard'
import { Clock, TimeBar } from './map/TimeBar'
import { SampledResidents, Objections, WhoOrdered } from './panels/Breakdown'
import { Headline } from './panels/Headline'
import { HourChart } from './panels/HourChart'
import { ScenarioBar } from './panels/ScenarioBar'

/** Lane E: the prediction pane. The simulated city, the time-lapse of its day, and the numbers. */
export function RightPane() {
  usePlayheadDriver()
  useSimulateNewVersions()

  const concept = useMise((s) => s.concept)
  const scenario = useMise((s) => s.scenario)
  const selectedId = useMise((s) => s.selectedResidentId)
  const selectResident = useMise((s) => s.selectResident)
  const city = useCity()
  const prediction = useRunView((s) => s.prediction)
  const busy = useRunView((s) => s.busy)
  const baseline = useBaseline(prediction)
  const reduceMotion = useReducedMotion()

  const brand = concept?.brand.colors.primary ?? ''
  const color = useMemo(() => conceptColor(brand), [brand])
  const colorCss = css(color)

  const flows = useMemo<Flow[]>(
    () => (prediction && concept && city ? buildFlows(prediction, concept, city.restaurants) : []),
    [prediction, concept, city],
  )

  /** Each resident's order, preferring one from the concept. */
  const flowsByResident = useMemo(() => {
    const m = new Map<string, Flow>()
    for (const f of flows) {
      const had = m.get(f.residentId)
      if (!had || (f.concept && !had.concept)) m.set(f.residentId, f)
    }
    return m
  }, [flows])

  const residentsById = useMemo(() => new Map(city?.residents.map((r) => [r.id, r])), [city])
  const selected = selectedId ? (residentsById.get(selectedId) ?? null) : null
  const sampled = useMemo(
    () => (prediction?.sampleResidentIds ?? []).map((id) => residentsById.get(id)).filter((r) => r !== undefined),
    [prediction, residentsById],
  )

  // A new prediction replays its day, from the hour before the first order.
  useEffect(() => {
    if (!prediction) return
    if (reduceMotion) {
      usePlayhead.getState().seek(DAY_MINUTES)
      return
    }
    const first = Math.min(...prediction.orderFlows.map((f) => toDayMinutes(f.hour, f.minute)), DAY_MINUTES)
    usePlayhead.getState().playFrom(Math.max(0, Math.floor(first / 60) * 60 - 60))
  }, [prediction, reduceMotion])

  const closeResident = useCallback(() => selectResident(null), [selectResident])

  if (!concept) return null

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        <ScenarioBar scenario={scenario} />

        <div className="overflow-hidden rounded-card shadow-hairline" style={{ background: 'rgb(12 12 12)' }}>
          <div className="relative h-[clamp(320px,44vh,480px)]">
            <CityMap
              concept={concept}
              color={color}
              restaurants={city?.restaurants ?? []}
              residents={city?.residents ?? []}
              flows={flows}
              stolen={prediction?.stolenFrom ?? []}
              selected={selected}
              selectedFlow={selected ? (flowsByResident.get(selected.id) ?? null) : null}
              onSelectResident={selectResident}
            >
              <Clock scenario={prediction?.scenario ?? scenario} concept={concept} busy={busy} />
              {selected && city && (
                <ResidentCard
                  resident={selected}
                  flow={flowsByResident.get(selected.id) ?? null}
                  concept={concept}
                  color={color}
                  restaurants={city.restaurants}
                  onClose={closeResident}
                />
              )}
            </CityMap>
          </div>
          <TimeBar prediction={prediction} color={color} />
        </div>

        {prediction && (
          <>
            <Headline prediction={prediction} baseline={baseline} busy={busy} />
            <HourChart prediction={prediction} concept={concept} color={colorCss} busy={busy} />
            <div className="grid grid-cols-2 gap-3">
              <Objections prediction={prediction} busy={busy} />
              <WhoOrdered prediction={prediction} color={colorCss} busy={busy} />
            </div>
            <SampledResidents
              residents={sampled}
              flowsByResident={flowsByResident}
              concept={concept}
              color={colorCss}
              selectedId={selectedId}
              onSelect={selectResident}
              busy={busy}
            />
          </>
        )}
      </div>
    </div>
  )
}
