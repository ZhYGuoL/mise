import type { Segment } from '@mise/shared'

export const int = (n: number) => Math.round(n).toLocaleString('en-US')
export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
export const usdCents = (n: number) => `$${n.toFixed(2)}`
export const pct1 = (n: number) => `${n.toFixed(1)}%`

/** Signed delta, e.g. +18, -$40, +0.4 pts. Returns null when the change rounds to zero. */
export function signed(n: number, format: (abs: number) => string) {
  const text = format(Math.abs(n))
  if (/^[$]?0(\.0+)?( pts)?$/.test(text)) return null
  return `${n > 0 ? '+' : '-'}${text}`
}

export const SEGMENT_LABEL: Record<Segment, string> = {
  undergrad: 'Undergrads',
  grad_student: 'Grad students',
  young_professional: 'Young professionals',
  family: 'Families',
  other: 'Other',
}

export const SEGMENT_ONE: Record<Segment, string> = {
  undergrad: 'Undergrad',
  grad_student: 'Grad student',
  young_professional: 'Young professional',
  family: 'Family',
  other: 'Resident',
}

export const HOUSEHOLD_LABEL = {
  alone: 'Lives alone',
  roommates: 'Roommates',
  partner: 'Partner',
  family_with_kids: 'Family with kids',
} as const

export const DIET_LABEL = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  halal: 'Halal',
  gluten_free: 'Gluten free',
  spicy: 'Spicy',
  late_night: 'Late night',
} as const

/** Great-circle distance in miles. */
export function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Drop a leading parenthetical, e.g. "(شاورما عمر) Omar's Halal Grill" -> "Omar's Halal Grill". */
export const shortName = (name: string) => name.replace(/^\([^)]*\)\s*/, '')
