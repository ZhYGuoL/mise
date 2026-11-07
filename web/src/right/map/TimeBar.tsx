import type { Concept, Prediction } from '@mise/shared'
import { Pause, Play } from 'lucide-react'
import { useRef } from 'react'
import LoadingState from '@/components/primitives/LoadingState'
import { css, type RGB } from '../lib/color'
import { ordersSoFar } from '../lib/flows'
import { usePlayhead } from '../lib/playhead'
import { DAY_MINUTES, DAY_START_HOUR, clockLabel, hourLabel, hourSlot, openWindow } from '../lib/time'

/** Shown on the map while a new run is simulating. The previous day stays drawn under it. */
export function MapLoading() {
  return (
    // .mise-loading flattens the label (see map.css).
    <div className="mise-loading pointer-events-none absolute top-3 left-3 z-10 rounded-control bg-surface px-2.5 py-1.5 shadow-[0_0_0_1px_var(--line-strong)]">
      <LoadingState label="Simulating" />
    </div>
  )
}

const SLOTS = Array.from({ length: 24 }, (_, i) => i)
const TICKS = [0, 6, 12, 18, 24]

/** Play button, the clock, a scrubber drawn as the hourly order histogram, and the running order count. */
export function TimeBar({ prediction, concept, color }: { prediction: Prediction | null; concept: Concept; color: RGB }) {
  const t = usePlayhead((s) => s.t)
  const playing = usePlayhead((s) => s.playing)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const bySlot = SLOTS.map((slot) => prediction?.byHour.find((b) => hourSlot(b.hour) === slot)?.p50 ?? 0)
  const max = Math.max(1, ...bySlot)
  const count = prediction ? ordersSoFar(prediction, t) : 0
  const x = t / DAY_MINUTES
  const ended = t >= DAY_MINUTES

  const open = prediction ? openWindow(concept, prediction.scenario.day) : null
  const isOpen = open !== null && t >= open[0] && t < open[1]
  const status = ended ? 'End of day' : isOpen ? 'Open' : 'Closed'

  const seekTo = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    usePlayhead.getState().seek(((clientX - r.left) / r.width) * DAY_MINUTES)
  }

  return (
    <div className="flex h-14 items-center gap-3 border-t border-line bg-surface px-3">
      <button
        type="button"
        aria-label={playing ? 'Pause' : ended ? 'Replay the day' : 'Play'}
        onClick={() => usePlayhead.getState().toggle()}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-surface transition-transform duration-100 active:scale-[0.94]"
      >
        <Play
          className="col-start-1 row-start-1 size-3.5 translate-x-[1px] fill-current transition-[opacity,scale] duration-100"
          style={{ opacity: playing ? 0 : 1, scale: playing ? 0.6 : 1 }}
        />
        <Pause
          className="col-start-1 row-start-1 size-3.5 fill-current transition-[opacity,scale] duration-100"
          style={{ opacity: playing ? 1 : 0, scale: playing ? 1 : 0.6 }}
        />
      </button>

      <div className="flex w-[66px] shrink-0 flex-col gap-1 leading-none">
        <span className="text-[13px] font-semibold text-ink tabular-nums">{clockLabel(t)}</span>
        <span className="text-[11.5px] whitespace-nowrap text-ink-3">{status}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Time of day"
          aria-valuemin={0}
          aria-valuemax={DAY_MINUTES}
          aria-valuenow={Math.round(t)}
          aria-valuetext={clockLabel(t)}
          className="relative flex h-6 cursor-pointer touch-none items-end gap-px rounded-[3px] outline-offset-2"
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            usePlayhead.getState().pause()
            seekTo(e.clientX)
          }}
          onPointerMove={(e) => dragging.current && seekTo(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={(e) => {
            const s = usePlayhead.getState()
            const step = e.shiftKey ? 60 : 15
            if (e.key === 'ArrowRight') s.seek(s.t + step)
            else if (e.key === 'ArrowLeft') s.seek(s.t - step)
            else if (e.key === 'Home') s.seek(0)
            else if (e.key === 'End') s.seek(DAY_MINUTES)
            else return
            e.preventDefault()
          }}
        >
          {bySlot.map((v, slot) => {
            const past = (slot + 1) * 60 <= t
            return (
              <span
                key={slot}
                className="min-w-0 flex-1 rounded-t-[2px]"
                style={{
                  height: `${Math.max(v > 0 ? 12 : 4, (v / max) * 100)}%`,
                  background: v > 0 ? (past ? css(color, 0.9) : 'var(--hover-2)') : 'var(--line)',
                }}
              />
            )
          })}
          <span
            className="pointer-events-none absolute -top-1 -bottom-0.5 w-0.5 rounded-full bg-ink"
            style={{ left: `calc(${x * 100}% - 1px)` }}
          />
        </div>
        <div className="relative h-3 text-[10.5px] leading-none text-ink-3 tabular-nums">
          {TICKS.map((slot) => (
            <span
              key={slot}
              className="absolute top-0"
              style={{
                left: `${(slot / 24) * 100}%`,
                transform: slot === 0 ? 'none' : slot === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {hourLabel(slot + DAY_START_HOUR)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex w-[84px] shrink-0 items-baseline justify-end gap-1.5">
        <span className="size-2 shrink-0 self-center rounded-full" style={{ background: css(color) }} />
        <span className="text-[13px] leading-none font-semibold text-ink tabular-nums">{count}</span>
        <span className="text-[12px] leading-none text-ink-3">orders</span>
      </div>
    </div>
  )
}
