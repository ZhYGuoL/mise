import type { Concept, Prediction, Restaurant } from '@mise/shared'
import { DAY_MINUTES, hourSlot, toDayMinutes } from './time'

export type LonLat = [number, number]

/** One order on the time-lapse: a curved path from a resident's home to a restaurant. */
export type Flow = {
  residentId: string
  /** minutes since 06:00 */
  t: number
  concept: boolean
  /** The restaurant from the prediction. null for the concept, or when the sim did not say. */
  placeId: string | null
  from: LonLat
  to: LonLat
  ctrl: LonLat
}

/** Time for an order to travel from home to restaurant, in simulated minutes (~0.4 s on screen). */
export const FLIGHT_MINUTES = 50
/** Trail length, as a fraction of the path. */
export const TRAIL = 0.55
/** Arrival ring lifetime, in simulated minutes. */
export const PULSE_MINUTES = 42

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Bend each path a little to the left of travel, so overlapping orders fan out. */
function control(from: LonLat, to: LonLat): LonLat {
  const k = Math.cos((from[1] * Math.PI) / 180)
  const dx = (to[0] - from[0]) * k
  const dy = to[1] - from[1]
  const bend = 0.22
  return [(from[0] + to[0]) / 2 - (dy * bend) / k, (from[1] + to[1]) / 2 + dx * bend]
}

/**
 * Resolve every order in the prediction to map coordinates. Orders to "other" with a placeId we
 * know go to that restaurant. The rest go to one of the six restaurants nearest the home, picked
 * by resident id so the same order always lands in the same place.
 */
export function buildFlows(prediction: Prediction, concept: Concept, restaurants: Restaurant[]): Flow[] {
  const byId = new Map(restaurants.map((r) => [r.placeId, r]))
  const conceptAt: LonLat = [concept.location.lon, concept.location.lat]

  const nearest = (lon: number, lat: number) => {
    const k = Math.cos((lat * Math.PI) / 180)
    return restaurants
      .map((r) => ({ r, d: ((r.lon - lon) * k) ** 2 + (r.lat - lat) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map((x) => x.r)
  }

  return prediction.orderFlows
    .map((f): Flow | null => {
      const from: LonLat = [f.from.lon, f.from.lat]
      let to: LonLat | null = null
      let placeId: string | null = null
      if (f.restaurant === 'concept') {
        to = conceptAt
      } else {
        const known = f.placeId ? byId.get(f.placeId) : undefined
        const pick = known ?? nearest(f.from.lon, f.from.lat)[hash(f.residentId + f.hour + f.minute) % 6]
        if (pick) to = [pick.lon, pick.lat]
        // Only name a restaurant the prediction named. The nearby pick is for drawing only.
        if (known) placeId = known.placeId
      }
      if (!to) return null
      return {
        residentId: f.residentId,
        t: toDayMinutes(f.hour, f.minute),
        concept: f.restaurant === 'concept',
        placeId,
        from,
        to,
        ctrl: control(from, to),
      }
    })
    .filter((f): f is Flow => f !== null)
    .sort((a, b) => a.t - b.t)
}

/** Point at s (0..1) on the flow's quadratic curve. */
export function pointAt(f: Flow, s: number): LonLat {
  const a = (1 - s) * (1 - s)
  const b = 2 * (1 - s) * s
  const c = s * s
  return [a * f.from[0] + b * f.ctrl[0] + c * f.to[0], a * f.from[1] + b * f.ctrl[1] + c * f.to[1]]
}

/** The visible stretch of the curve between two fractions. */
export function segment(f: Flow, s0: number, s1: number, steps = 14): LonLat[] {
  const out: LonLat[] = []
  for (let i = 0; i <= steps; i++) out.push(pointAt(f, s0 + ((s1 - s0) * i) / steps))
  return out
}

/** Hourly p50 orders added up to t (minutes since 06:00). */
function hourlySoFar(prediction: Prediction, t: number) {
  let total = 0
  for (const b of prediction.byHour) {
    const start = hourSlot(b.hour) * 60
    total += b.p50 * Math.min(Math.max((t - start) / 60, 0), 1)
  }
  return total
}

/**
 * Concept orders so far, for the time-lapse counter. The hourly p50s give the shape of the day.
 * The sum of hourly medians is not the median of the day, so the curve is scaled to end exactly
 * at the headline orders p50.
 */
export function ordersSoFar(prediction: Prediction, t: number) {
  const target = Math.round(prediction.orders.p50)
  const total = hourlySoFar(prediction, DAY_MINUTES)
  if (total <= 0) return t >= DAY_MINUTES ? target : 0
  const sofar = hourlySoFar(prediction, t)
  return sofar >= total ? target : Math.floor((target * sofar) / total)
}
