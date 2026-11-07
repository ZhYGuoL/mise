import type { Concept, Scenario } from '@mise/shared'

/**
 * The time-lapse and the hourly chart share one axis: a business day that starts at 06:00
 * and ends at 06:00 the next day, so late-night orders (00:00 to 02:00) land at the end of
 * the day they belong to. t is minutes since 06:00, from 0 to DAY_MINUTES.
 */
export const DAY_START_HOUR = 6
export const DAY_MINUTES = 24 * 60

/** One simulated day plays in this many seconds. */
export const PLAYBACK_SECONDS = 12
export const MINUTES_PER_SECOND = DAY_MINUTES / PLAYBACK_SECONDS

/** Clock hour (0-23) to its slot on the business-day axis (0-23). */
export const hourSlot = (hour: number) => (((hour - DAY_START_HOUR) % 24) + 24) % 24

/** Clock hour and minute to minutes since 06:00. */
export const toDayMinutes = (hour: number, minute: number) => hourSlot(hour) * 60 + minute

/** Minutes since 06:00 to "HH:MM" on a 24h clock. */
export function clockLabel(t: number) {
  const total = (Math.floor(t) + DAY_START_HOUR * 60) % DAY_MINUTES
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Clock hour to a short axis label: 6a, 12p, 6p, 12a. */
export function hourLabel(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const suffix = h < 12 ? 'a' : 'p'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}${suffix}`
}

/** "HH:MM" to minutes since 06:00. */
export function hmToDayMinutes(hm: string) {
  const [h, m] = hm.split(':').map(Number)
  return toDayMinutes(h, m)
}

/** Open interval for the day in minutes since 06:00, or null when closed all day. */
export function openWindow(concept: Concept, day: Scenario['day']): [number, number] | null {
  const h = concept.hours[day]
  if (!h) return null
  const open = hmToDayMinutes(h.open)
  let close = hmToDayMinutes(h.close)
  if (close <= open) close += DAY_MINUTES
  return [open, Math.min(close, DAY_MINUTES)]
}
