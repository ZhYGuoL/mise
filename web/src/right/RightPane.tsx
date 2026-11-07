import { useEffect, useMemo } from 'react'
import { useMise } from '@/state/store'
import { conceptColor, css } from './lib/color'
import { useBaseline, useCity, useRunView, useSimulateNewVersions } from './lib/data'
import { buildFlows, type Flow } from './lib/flows'
import { usePlayhead, usePlayheadDriver } from './lib/playhead'
import { DAY_MINUTES, toDayMinutes } from './lib/time'
import { CityCard } from './map/CityCard'
import { Interview } from './interview/Interview'
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

  // A new prediction rests on the end of its day, with every order drawn. Play replays the day
  // from the hour before the first order.
  useEffect(() => {
    if (!prediction) return
    const first = Math.min(...prediction.orderFlows.map((f) => toDayMinutes(f.hour, f.minute)), DAY_MINUTES)
    usePlayhead.getState().rest(Math.floor(first / 60) * 60 - 60)
  }, [prediction])

  if (!concept) return null

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        <ScenarioBar scenario={scenario} />

        <CityCard
          concept={concept}
          scenario={scenario}
          prediction={prediction}
          busy={busy}
          color={color}
          restaurants={city?.restaurants ?? null}
          residents={city?.residents ?? []}
          flows={flows}
          flowsByResident={flowsByResident}
          selected={selected}
          onSelectResident={selectResident}
        />

        {/* Wave 2: interview the selected resident. */}
        {selected && <Interview resident={selected} concept={concept} scenario={scenario} color={colorCss} />}

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
              decisions={prediction.sampleDecisions}
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
