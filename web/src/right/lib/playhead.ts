import { useEffect } from 'react'
import { create } from 'zustand'
import { DAY_MINUTES, MINUTES_PER_SECOND } from './time'

/** Time-lapse clock shared by the map, the scrubber and the hourly chart. Lane E only. */
type Playhead = {
  /** minutes since 06:00 */
  t: number
  playing: boolean
  /** Where Play starts a replay of the day: the hour before the first order. */
  start: number
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  /** Rest on the end-of-day frame, with every order drawn. Used when a new prediction lands. */
  rest: (start: number) => void
}

const clamp = (t: number) => Math.min(Math.max(t, 0), DAY_MINUTES)

export const usePlayhead = create<Playhead>()((set, get) => ({
  t: 0,
  playing: false,
  start: 0,
  play: () => set((s) => ({ playing: true, t: s.t >= DAY_MINUTES ? s.start : s.t })),
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => set({ t: clamp(t) }),
  rest: (start) => set({ t: DAY_MINUTES, playing: false, start: clamp(start) }),
}))

/** Mount once. Advances the clock while playing and stops at the end of the day. */
export function usePlayheadDriver() {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // Cap the step so a backgrounded tab does not jump to the end of the day.
      const dt = Math.min(now - last, 100) / 1000
      last = now
      const s = usePlayhead.getState()
      if (s.playing) {
        const t = s.t + dt * MINUTES_PER_SECOND
        usePlayhead.setState(t >= DAY_MINUTES ? { t: DAY_MINUTES, playing: false } : { t })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
