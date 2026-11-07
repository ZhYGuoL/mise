/** Fluid Functionalism spring tokens. The bigger the thing that moves, the slower the spring. */
export const spring = {
  fast: { type: 'spring', duration: 0.08, bounce: 0 },
  moderate: { type: 'spring', duration: 0.16, bounce: 0 },
  slow: { type: 'spring', duration: 0.24, bounce: 0.12 },
} as const
