import type { Layer } from '@deck.gl/core'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Prediction, Resident, Restaurant } from '@mise/shared'
import { MAP, type RGB } from '../lib/color'
import { FLIGHT_MINUTES, PULSE_MINUTES, TRAIL, pointAt, segment, type Flow, type LonLat } from '../lib/flows'
import { DAY_MINUTES } from '../lib/time'

export type Scene = {
  concept: LonLat
  color: RGB
  restaurants: Restaurant[]
  residents: Resident[]
  flows: Flow[]
  stolen: Prediction['stolenFrom']
}

/** What the viewer points at. Kept apart from the scene, so it never rebuilds the cached layers. */
export type Focus = {
  selected: Resident | null
  selectedFlow: Flow | null
  /** A restaurant to mark, e.g. while its row in the customers-taken list is hovered. */
  highlight: string | null
}

type RGBA = [number, number, number, number]
type Trail = { path: LonLat[]; color: RGBA; width: number }
type Dot = { at: LonLat; color: RGBA; radius: number }

const rgba = (c: RGB, a: number): RGBA => [c[0], c[1], c[2], Math.round(a)]

/** Static layers only change when the data does. Cached per scene. */
const staticCache = new WeakMap<Scene, { below: Layer[]; above: Layer[] }>()

function staticLayers(scene: Scene) {
  const cached = staticCache.get(scene)
  if (cached) return cached
  const stolenIds = new Set(scene.stolen.map((s) => s.placeId))
  const layers = {
    below: [
      new ScatterplotLayer<Resident>({
        id: 'residents',
        data: scene.residents,
        getPosition: (r) => [r.home.lon, r.home.lat],
        getFillColor: rgba(MAP.dot, 200),
        getRadius: 1.6,
        radiusUnits: 'pixels',
        pickable: true,
      }),
      new ScatterplotLayer<Restaurant>({
        id: 'restaurants',
        data: scene.restaurants.filter((r) => !stolenIds.has(r.placeId)),
        getPosition: (r) => [r.lon, r.lat],
        getFillColor: rgba(MAP.place, 255),
        getRadius: 2.4,
        radiusUnits: 'pixels',
      }),
    ],
    above: [
      new ScatterplotLayer<Prediction['stolenFrom'][number]>({
        // Restaurants the concept takes customers from: solid ink, so they never read as the
        // concept's own color. Their labels carry the loss in red.
        id: 'stolen',
        data: scene.stolen,
        getPosition: (s) => [s.lon, s.lat],
        getFillColor: rgba(MAP.placeStrong, 255),
        getLineColor: rgba(MAP.surface, 255),
        getRadius: 3.5,
        radiusUnits: 'pixels',
        stroked: true,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
      }),
    ],
  }
  staticCache.set(scene, layers)
  return layers
}

/**
 * Orders that have arrived stay on the map as a faint arc, so the end of the day shows every
 * order at once. Arcs are sorted by arrival and drawn in fixed chunks. A full chunk keeps the same
 * data array, so deck.gl does not rebuild it. A new arrival only rebuilds the short chunk at the end.
 * Layer objects are made new on every frame: deck.gl finalizes a layer that leaves the list (as
 * chunks do when Play rewinds the day), and a finalized layer does not draw if it is passed again.
 */
const CHUNK = 64

type Settled = {
  kind: 'concept' | 'other'
  arrivals: number[]
  paths: LonLat[][]
  homes: LonLat[]
  chunks: LonLat[][][]
  tail: { n: number; data: LonLat[][] }
  homesAt: { n: number; data: LonLat[] }
}

const settledCache = new WeakMap<Scene, { concept: Settled; other: Settled }>()

function settled(scene: Scene) {
  const cached = settledCache.get(scene)
  if (cached) return cached
  const make = (kind: Settled['kind']): Settled => ({
    kind,
    arrivals: [],
    paths: [],
    homes: [],
    chunks: [],
    tail: { n: 0, data: [] },
    homesAt: { n: 0, data: [] },
  })
  const out = { concept: make('concept'), other: make('other') }
  // Flows are sorted by order time, and every flight takes the same time, so arrivals are sorted too.
  for (const f of scene.flows) {
    const s = f.concept ? out.concept : out.other
    s.arrivals.push(f.t + FLIGHT_MINUTES)
    s.paths.push(segment(f, 0, 1, 16))
    s.homes.push(f.from)
  }
  settledCache.set(scene, out)
  return out
}

/** Number of arrivals at or before t. At the end of the day, every order counts. */
function arrived(arrivals: number[], t: number) {
  if (t >= DAY_MINUTES) return arrivals.length
  let lo = 0
  let hi = arrivals.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arrivals[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const pathOf = (d: LonLat[]) => d

function settledLayers(scene: Scene, s: Settled, n: number): Layer[] {
  const concept = s.kind === 'concept'
  const layer = (id: string, data: LonLat[][]) =>
    new PathLayer<LonLat[]>({
      id,
      data,
      getPath: pathOf,
      getColor: concept ? rgba(scene.color, 140) : rgba(MAP.ink, 22),
      getWidth: concept ? 1.25 : 1,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    })
  const out: Layer[] = []
  const full = Math.floor(n / CHUNK)
  for (let i = 0; i < full; i++) {
    s.chunks[i] ??= s.paths.slice(i * CHUNK, (i + 1) * CHUNK)
    out.push(layer(`settled-${s.kind}-${i}`, s.chunks[i]))
  }
  if (n > full * CHUNK) {
    if (s.tail.n !== n) s.tail = { n, data: s.paths.slice(full * CHUNK, n) }
    out.push(layer(`settled-${s.kind}-tail`, s.tail.data))
  }
  return out
}

/** Homes of the concept's customers so far. Cached by count, so the layer only rebuilds on a new order. */
function customers(s: Settled, n: number): LonLat[] {
  if (s.homesAt.n !== n) s.homesAt = { n, data: s.homes.slice(0, n) }
  return s.homesAt.data
}

/** Every layer for the scene at time t (minutes since 06:00). */
export function buildLayers(scene: Scene, focus: Focus, t: number): Layer[] {
  const trails: Trail[] = []
  const heads: Dot[] = []
  const rings: Dot[] = []
  const span = FLIGHT_MINUTES * (1 + TRAIL) + PULSE_MINUTES

  // Orders in flight. At the end of the day every order has landed, so nothing moves.
  if (t < DAY_MINUTES) {
    for (const f of scene.flows) {
      const age = t - f.t
      if (age < 0) break
      if (age > span) continue
      const tint = f.concept ? scene.color : MAP.place
      const p = age / FLIGHT_MINUTES
      const head = Math.min(p, 1)
      const tail = Math.min(Math.max(p - TRAIL, 0), 1)
      if (head - tail > 0.01) {
        const fade = p > 1 ? 1 - (p - 1) / TRAIL : 1
        trails.push({
          path: segment(f, tail, head),
          color: rgba(tint, (f.concept ? 235 : 80) * fade),
          width: f.concept ? 2 : 1.2,
        })
      }
      if (p <= 1) {
        heads.push({ at: pointAt(f, head), color: rgba(tint, f.concept ? 255 : 130), radius: f.concept ? 2.6 : 1.8 })
      }
      const since = age - FLIGHT_MINUTES
      if (since >= 0 && since <= PULSE_MINUTES) {
        const k = since / PULSE_MINUTES
        rings.push({
          at: f.to,
          color: rgba(tint, (f.concept ? 220 : 70) * (1 - k)),
          radius: (f.concept ? 8 : 3.5) + (f.concept ? 14 : 6) * k,
        })
      }
    }
  }

  const fixed = staticLayers(scene)
  const done = settled(scene)
  const nConcept = arrived(done.concept.arrivals, t)
  const highlight = focus.highlight ? scene.stolen.find((s) => s.placeId === focus.highlight) : undefined

  const layers: Layer[] = [
    ...fixed.below,
    ...(new URLSearchParams(location.search).get('trails') !== '1' ? [] : settledLayers(scene, done.other, arrived(done.other.arrivals, t))),
    ...settledLayers(scene, done.concept, nConcept),
    ...fixed.above,
    new ScatterplotLayer<LonLat>({
      id: 'customers',
      data: customers(done.concept, nConcept),
      getPosition: (d) => d,
      getFillColor: rgba(scene.color, 220),
      getRadius: 2,
      radiusUnits: 'pixels',
    }),
    new PathLayer<Trail>({
      id: 'trails',
      data: trails,
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
    new ScatterplotLayer<Dot>({
      id: 'rings',
      data: rings,
      getPosition: (d) => d.at,
      getLineColor: (d) => d.color,
      getRadius: (d) => d.radius,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineWidth: 1.25,
      lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer<Dot>({
      id: 'heads',
      data: heads,
      getPosition: (d) => d.at,
      getFillColor: (d) => d.color,
      getRadius: (d) => d.radius,
      radiusUnits: 'pixels',
    }),
    new ScatterplotLayer<LonLat>({
      id: 'highlight',
      data: highlight ? [[highlight.lon, highlight.lat]] : [],
      getPosition: (d) => d,
      getLineColor: rgba(MAP.ink, 230),
      getRadius: 8,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer<LonLat>({
      id: 'concept',
      data: [scene.concept],
      getPosition: (d) => d,
      getFillColor: rgba(scene.color, 255),
      getLineColor: rgba(MAP.surface, 255),
      getRadius: 6.5,
      radiusUnits: 'pixels',
      stroked: true,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      updateTriggers: { getFillColor: scene.color },
    }),
  ]

  if (focus.selected) {
    const home: LonLat = [focus.selected.home.lon, focus.selected.home.lat]
    if (focus.selectedFlow) {
      layers.push(
        new PathLayer<Flow>({
          id: 'selected-path',
          data: [focus.selectedFlow],
          getPath: (f) => segment(f, 0, 1, 24),
          getColor: (f) => (f.concept ? rgba(scene.color, 230) : rgba(MAP.ink, 200)),
          getWidth: 1.75,
          widthUnits: 'pixels',
          capRounded: true,
        }),
      )
    }
    layers.push(
      new ScatterplotLayer<LonLat>({
        id: 'selected',
        data: [home],
        getPosition: (d) => d,
        getFillColor: rgba(MAP.placeStrong, 255),
        getLineColor: rgba(MAP.surface, 255),
        getRadius: 3.5,
        radiusUnits: 'pixels',
        stroked: true,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
      }),
      new ScatterplotLayer<LonLat>({
        id: 'selected-ring',
        data: [home],
        getPosition: (d) => d,
        getLineColor: rgba(MAP.ink, 230),
        getRadius: 9,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
      }),
    )
  }

  return layers
}
