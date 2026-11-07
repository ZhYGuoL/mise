import { Prediction, Resident, Restaurant, type Concept, type Scenario } from '@mise/shared'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { create } from 'zustand'
import predictionFixture from '../../../../data/fixtures/prediction.json'
import residentsFixture from '../../../../data/fixtures/residents.sample.json'
import restaurantsFixture from '../../../../data/fixtures/restaurants.json'
import { api } from '@/api'
import { useMise } from '@/state/store'

/* ───────────── city: restaurants and residents ───────────── */

export type City = { restaurants: Restaurant[]; residents: Resident[] }

const RESIDENT_SAMPLE = 3000

let cityPromise: Promise<City> | null = null

/** Fetch once per page. Each call falls back to its fixture if the endpoint fails. */
function loadCity(): Promise<City> {
  cityPromise ??= Promise.all([
    api.cityRestaurants().catch(() => z.array(Restaurant).parse(restaurantsFixture)),
    api.cityResidents(RESIDENT_SAMPLE).catch(() => z.array(Resident).parse(residentsFixture)),
  ]).then(([restaurants, residents]) => ({ restaurants, residents }))
  return cityPromise
}

export function useCity(): City | null {
  const [city, setCity] = useState<City | null>(null)
  useEffect(() => {
    let live = true
    void loadCity().then((c) => live && setCity(c))
    return () => {
      live = false
    }
  }, [])
  return city
}

/* ───────────── simulation runs ───────────── */

export const sameScenario = (a: Scenario, b: Scenario) =>
  a.day === b.day && a.weather === b.weather && a.event === b.event

/** Run the simulation for the current concept and scenario. Never throws. */
export function runSimulation() {
  void useMise
    .getState()
    .simulate()
    .catch(() => {})
}

/** Change the scenario and re-run. */
export function runScenario(patch: Partial<Scenario>) {
  useMise.getState().setScenario(patch)
  runSimulation()
}

function fixtureFor(concept: Concept, scenario: Scenario) {
  return Prediction.parse({
    ...predictionFixture,
    conceptId: concept.id,
    conceptVersion: concept.version,
    scenario,
  })
}

/** Keep the loading state up at least this long, so a fast run still reads as a run. */
const MIN_BUSY_MS = 500

/**
 * What the pane shows. While a run is in flight it holds the previous prediction (shown
 * dimmed), then swaps to the new one when the run ends. `fixture` is true when the last run
 * failed and the pane fell back to the fixture prediction.
 */
export const useRunView = create<{ prediction: Prediction | null; busy: boolean; fixture: boolean }>()(() => ({
  prediction: useMise.getState().prediction,
  busy: useMise.getState().simulating,
  fixture: false,
}))

let startedAt = 0
let holdTimer: ReturnType<typeof setTimeout> | undefined

const unsubscribe = useMise.subscribe((s, prev) => {
  if (s.simulating && !prev.simulating) {
    clearTimeout(holdTimer)
    startedAt = performance.now()
    useRunView.setState({ busy: true })
    return
  }
  if (!s.simulating && prev.simulating) {
    const ok =
      s.prediction !== null &&
      s.concept !== null &&
      s.prediction.conceptVersion === s.concept.version &&
      sameScenario(s.prediction.scenario, s.scenario)
    // A failed run leaves no prediction for this concept and scenario. Show the fixture instead.
    if (!ok && s.concept) useMise.getState().setPrediction(fixtureFor(s.concept, s.scenario))
    useRunView.setState({ fixture: !ok })
    const wait = Math.max(0, MIN_BUSY_MS - (performance.now() - startedAt))
    holdTimer = setTimeout(() => useRunView.setState({ busy: false, prediction: useMise.getState().prediction }), wait)
    return
  }
  // Predictions that arrive outside a run (for example from the agent stream) show at once.
  if (s.prediction !== prev.prediction && !useRunView.getState().busy) {
    useRunView.setState({ prediction: s.prediction })
  }
})
import.meta.hot?.dispose(() => {
  unsubscribe()
  clearTimeout(holdTimer)
})

/** When the agent makes a new concept version and nothing simulates it, run it here. */
export function useSimulateNewVersions() {
  const conceptId = useMise((s) => s.concept?.id)
  const version = useMise((s) => s.concept?.version)
  useEffect(() => {
    if (version === undefined) return
    const id = setTimeout(() => {
      const s = useMise.getState()
      if (s.simulating || !s.concept) return
      if (s.prediction?.conceptId === s.concept.id && s.prediction.conceptVersion === s.concept.version) return
      runSimulation()
    }, 400)
    return () => clearTimeout(id)
  }, [conceptId, version])
}

/* ───────────── version compare ───────────── */

export type Baseline = { version: number; prediction: Prediction }

const baselineCache = new Map<string, Prediction>()
const scenarioKey = (s: Scenario) => `${s.day}|${s.weather}|${s.event}`

/**
 * The previous concept version's prediction under the same scenario as `current`, so the
 * delta measures the edit and not a scenario change. Re-simulates the previous version when
 * its stored prediction was computed for another scenario.
 */
export function useBaseline(current: Prediction | null): Baseline | null {
  const versions = useMise((s) => s.versions)
  // Bumped when a baseline fetch lands, so the render below reads it from the cache.
  const [, setLoaded] = useState(0)

  const i = current ? versions.findIndex((v) => v.concept.version === current.conceptVersion) : -1
  const prev = i > 0 ? versions[i - 1] : null
  const key = prev && current ? `${prev.concept.id}:${prev.concept.version}:${scenarioKey(current.scenario)}` : null
  const stored = prev?.prediction && current && sameScenario(prev.prediction.scenario, current.scenario)
    ? prev.prediction
    : null

  useEffect(() => {
    if (!key || !prev || !current || stored || baselineCache.has(key)) return
    const ctrl = new AbortController()
    api
      .simulate({ concept: prev.concept, scenario: current.scenario }, ctrl.signal)
      .then((p) => {
        baselineCache.set(key, p)
        setLoaded((n) => n + 1)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [key, prev, current, stored])

  if (!prev || !key) return null
  const prediction = stored ?? baselineCache.get(key) ?? null
  return prediction ? { version: prev.concept.version, prediction } : null
}
