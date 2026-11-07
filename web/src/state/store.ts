import { Concept, type Prediction, type Scenario } from '@mise/shared'
import { create } from 'zustand'
import seed from '../../../data/fixtures/concept.json'
import { api } from '@/api'

/** One entry per concept version, like a git log. prediction is null until a simulation returns. */
export type Version = { concept: Concept; prediction: Prediction | null }

type MiseState = {
  concept: Concept | null
  versions: Version[]
  /** Prediction for the current concept and scenario. */
  prediction: Prediction | null
  scenario: Scenario
  selectedResidentId: string | null
  simulating: boolean

  /** Set the current concept. A new version number adds a version, the same number replaces it. */
  setConcept: (concept: Concept) => void
  /** Store a prediction and attach it to the version it was computed for. */
  setPrediction: (prediction: Prediction) => void
  setScenario: (patch: Partial<Scenario>) => void
  selectResident: (id: string | null) => void
  /** Run /api/simulate for the current concept and scenario. Stale responses are dropped. */
  simulate: () => Promise<void>
}

let simulateRun = 0

export const useMise = create<MiseState>()((set, get) => ({
  // Seeded with the fixture concept so both panes render before the agent creates one.
  concept: Concept.parse(seed),
  versions: [{ concept: Concept.parse(seed), prediction: null }],
  prediction: null,
  scenario: { day: 'Friday', weather: 'clear', event: 'none', runs: 100 },
  selectedResidentId: null,
  simulating: false,

  setConcept: (concept) =>
    set((s) => {
      const i = s.versions.findIndex((v) => v.concept.version === concept.version)
      const versions =
        i === -1
          ? [...s.versions, { concept, prediction: null }]
          : s.versions.map((v, j) => (j === i ? { ...v, concept } : v))
      return { concept, versions }
    }),

  setPrediction: (prediction) =>
    set((s) => ({
      prediction: prediction.conceptVersion === s.concept?.version ? prediction : s.prediction,
      versions: s.versions.map((v) =>
        v.concept.version === prediction.conceptVersion ? { ...v, prediction } : v,
      ),
    })),

  setScenario: (patch) => set((s) => ({ scenario: { ...s.scenario, ...patch } })),

  selectResident: (id) => set({ selectedResidentId: id }),

  simulate: async () => {
    const { concept, scenario } = get()
    if (!concept) return
    const run = ++simulateRun
    set({ simulating: true })
    try {
      const prediction = await api.simulate({ concept, scenario })
      if (run === simulateRun) get().setPrediction(prediction)
    } finally {
      if (run === simulateRun) set({ simulating: false })
    }
  },
}))
