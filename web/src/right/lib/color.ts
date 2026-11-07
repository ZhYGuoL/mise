export type RGB = [number, number, number]

/** Fallback when the brand color is not a parseable hex. Matches the Beautiful UI accent. */
const FALLBACK: RGB = [2, 133, 255]

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const v = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round) as RGB
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((c) => Math.round(c * 255)) as RGB
}

/**
 * The concept's color on the light pane: its brand primary, kept dark enough to read on white and
 * on the grey map, and saturated enough to stand apart from the grey competitors.
 */
export function conceptColor(brandPrimary: string): RGB {
  const rgb = hexToRgb(brandPrimary)
  if (!rgb) return FALLBACK
  const [h, s, l] = rgbToHsl(rgb)
  if (s < 0.25) return FALLBACK
  return hslToRgb([h, Math.max(s, 0.6), Math.min(Math.max(l, 0.4), 0.55)])
}

export const css = ([r, g, b]: RGB, alpha = 1) => `rgb(${r} ${g} ${b} / ${alpha})`

/** Map palette, from the Beautiful UI tokens so the map reads as part of the page. Flat colors only. */
export const MAP = {
  /** --canvas */
  land: [241, 242, 243] as RGB,
  /** a step darker than the land */
  water: [222, 226, 230] as RGB,
  /** --line-strong and a step lighter: roads are hairlines */
  road: [221, 223, 227] as RGB,
  roadMinor: [229, 231, 234] as RGB,
  /** --ink. Residents, other orders and restaurants are ink at low opacity, so they read as neutral grey. */
  ink: [31, 33, 36] as RGB,
  /** --surface */
  surface: [255, 255, 255] as RGB,
}
