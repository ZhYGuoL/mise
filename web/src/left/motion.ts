/** Fluid Functionalism spring tiers. Pick by the size of what moves. */
export const spring = {
  fast: { type: 'spring', duration: 0.08, bounce: 0 },
  moderate: { type: 'spring', duration: 0.16, bounce: 0 },
  slow: { type: 'spring', duration: 0.24, bounce: 0.12 },
} as const

export const exit = {
  fast: { duration: 0.06 },
  moderate: { duration: 0.12 },
  slow: { duration: 0.16 },
} as const
