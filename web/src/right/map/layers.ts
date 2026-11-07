import type { Layer } from '@deck.gl/core'
import { LineLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Prediction, Resident, Restaurant } from '@mise/shared'
import { MAP, type RGB } from '../lib/color'
import { FLIGHT_MINUTES, PULSE_MINUTES, TRAIL, pointAt, segment, type Flow, type LonLat } from '../lib/flows'

export type Scene = {
  concept: LonLat
  color: RGB
  restaurants: Restaurant[]
  residents: Resident[]
  flows: Flow[]
  stolen: Prediction['stolenFrom']
  selected: Resident | null
  selectedFlow: Flow | null
}

type Trail = { path: LonLat[]; color: [number, number, number, number]; width: number }
type Dot = { at: LonLat; color: [number, number, number, number]; radius: number }

const rgba = (c: RGB, a: number): [number, number, number, number] => [c[0], c[1], c[2], Math.round(a)]

/** Static layers only change when the data does. Cached per scene. */
const staticCache = new WeakMap<Scene, Layer[]>()

function staticLayers(scene: Scene): Layer[] {
  const cached = staticCache.get(scene)
  if (cached) return cached
  const stolenIds = new Set(scene.stolen.map((s) => s.placeId))
  const layers: Layer[] = [
    new ScatterplotLayer<Resident>({
      id: 'residents',
      data: scene.residents,
      getPosition: (r) => [r.home.lon, r.home.lat],
      getFillColor: rgba(MAP.resident, 70),
      getRadius: 1.6,
      radiusUnits: 'pixels',
      pickable: true,
    }),
    new ScatterplotLayer<Restaurant>({
      id: 'restaurants',
      data: scene.restaurants.filter((r) => !stolenIds.has(r.placeId)),
      getPosition: (r) => [r.lon, r.lat],
      getFillColor: rgba(MAP.restaurant, 170),
      getRadius: 2.6,
      radiusUnits: 'pixels',
    }),
    new LineLayer<Prediction['stolenFrom'][number]>({
      id: 'stolen-lines',
      data: scene.stolen,
      getSourcePosition: (s) => [s.lon, s.lat],
      getTargetPosition: () => scene.concept,
      getColor: rgba(MAP.lost, 170),
      getWidth: 1,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer<Prediction['stolenFrom'][number]>({
      id: 'stolen',
      data: scene.stolen,
      getPosition: (s) => [s.lon, s.lat],
      getFillColor: rgba(MAP.lost, 255),
      getRadius: 3.2,
      radiusUnits: 'pixels',
    }),
  ]
  staticCache.set(scene, layers)
  return layers
}

/** Concept customers whose order has arrived, cached by count so the layer only rebuilds on a new order. */
const customerCache = new WeakMap<Scene, { count: number; data: LonLat[] }>()

function customers(scene: Scene, t: number): LonLat[] {
  let count = 0
  for (const f of scene.flows) {
    if (f.t + FLIGHT_MINUTES > t) break
    if (f.concept) count++
  }
  const cached = customerCache.get(scene)
  if (cached && cached.count === count) return cached.data
  const data: LonLat[] = []
  for (const f of scene.flows) {
    if (data.length === count) break
    if (f.concept && f.t + FLIGHT_MINUTES <= t) data.push(f.from)
  }
  customerCache.set(scene, { count, data })
  return data
}

/** Every layer for the scene at time t (minutes since 06:00). */
export function buildLayers(scene: Scene, t: number): Layer[] {
  const trails: Trail[] = []
  const heads: Dot[] = []
  const rings: Dot[] = []
  const window = FLIGHT_MINUTES * (1 + TRAIL) + PULSE_MINUTES

  for (const f of scene.flows) {
    const age = t - f.t
    if (age < 0) break
    if (age > window) continue
    const tint = f.concept ? scene.color : MAP.other
    const p = age / FLIGHT_MINUTES
    const head = Math.min(p, 1)
    const tail = Math.min(Math.max(p - TRAIL, 0), 1)
    if (head - tail > 0.01) {
      const fade = p > 1 ? 1 - (p - 1) / TRAIL : 1
      trails.push({
        path: segment(f, tail, head),
        color: rgba(tint, (f.concept ? 235 : 110) * fade),
        width: f.concept ? 2 : 1.2,
      })
    }
    if (p <= 1) {
      heads.push({ at: pointAt(f, head), color: rgba(f.concept ? scene.color : MAP.other, f.concept ? 255 : 170), radius: f.concept ? 2.6 : 1.8 })
    }
    const since = age - FLIGHT_MINUTES
    if (since >= 0 && since <= PULSE_MINUTES) {
      const k = since / PULSE_MINUTES
      rings.push({
        at: f.to,
        color: rgba(tint, (f.concept ? 220 : 90) * (1 - k)),
        radius: (f.concept ? 8 : 3.5) + (f.concept ? 14 : 6) * k,
      })
    }
  }

  const layers: Layer[] = [
    ...staticLayers(scene),
    new ScatterplotLayer<LonLat>({
      id: 'customers',
      data: customers(scene, t),
      getPosition: (d) => d,
      getFillColor: rgba(scene.color, 170),
      getRadius: 1.9,
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
      id: 'concept',
      data: [scene.concept],
      getPosition: (d) => d,
      getFillColor: rgba(scene.color, 255),
      getLineColor: [12, 12, 12, 255],
      getRadius: 7,
      radiusUnits: 'pixels',
      stroked: true,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      updateTriggers: { getFillColor: scene.color },
    }),
  ]

  if (scene.selected) {
    const home: LonLat = [scene.selected.home.lon, scene.selected.home.lat]
    if (scene.selectedFlow) {
      layers.push(
        new PathLayer<Flow>({
          id: 'selected-path',
          data: [scene.selectedFlow],
          getPath: (f) => segment(f, 0, 1, 24),
          getColor: (f) => rgba(f.concept ? scene.color : MAP.white, 200),
          getWidth: 1.5,
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
        getFillColor: rgba(MAP.white, 255),
        getLineColor: rgba(MAP.white, 255),
        getRadius: 3,
        radiusUnits: 'pixels',
      }),
      new ScatterplotLayer<LonLat>({
        id: 'selected-ring',
        data: [home],
        getPosition: (d) => d,
        getLineColor: rgba(MAP.white, 230),
        getRadius: 8,
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
