import { useEffect, useState } from 'react'

/** Motion tokens (Fluid Functionalism tiers). One place, so every Lane B surface moves the same. */
export const spring = {
  fast: { type: 'spring', duration: 0.08, bounce: 0 },
  moderate: { type: 'spring', duration: 0.16, bounce: 0 },
  slow: { type: 'spring', duration: 0.24, bounce: 0.12 },
} as const
/** A photo landing: a large surface, so the slow tier, without the bounce (opacity cannot overshoot). */
export const photoFade = { type: 'spring', duration: 0.24, bounce: 0 } as const

/** Seconds since `since`, ticking every 100 ms while `running`. */
export function useElapsed(since: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [running, since])
  return Math.max(0, (now - since) / 1000)
}

export const seconds = (s: number) => `${s.toFixed(1)}s`
