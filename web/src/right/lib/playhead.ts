import { useEffect } from 'react'
import { create } from 'zustand'
import { DAY_MINUTES, MINUTES_PER_SECOND } from './time'

/** Time-lapse clock shared by the map, the scrubber and the hourly chart. Lane E only. */
type Playhead = {
  /** minutes since 06:00 */
  t: number
  playing: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  /** Jump to t and play. Used when a new prediction lands. */
  playFrom: (t: number) => void
}

const clamp = (t: number) => Math.min(Math.max(t, 0), DAY_MINUTES)

export const usePlayhead = create<Playhead>()((set, get) => ({
  t: 0,
  playing: false,
  play: () => set((s) => ({ playing: true, t: s.t >= DAY_MINUTES ? 0 : s.t })),
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => set({ t: clamp(t) }),
  playFrom: (t) => set({ t: clamp(t), playing: true }),
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
