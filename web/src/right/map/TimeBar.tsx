import type { Concept, Prediction, Scenario } from '@mise/shared'
import { Pause, Play } from 'lucide-react'
import { useRef } from 'react'
import LoadingState from '@/components/primitives/LoadingState'
import { css, type RGB } from '../lib/color'
import { ordersSoFar } from '../lib/flows'
import { usePlayhead } from '../lib/playhead'
import { DAY_MINUTES, DAY_START_HOUR, clockLabel, hourLabel, hourSlot, openWindow } from '../lib/time'

const WEATHER = { clear: null, rain: 'Rain', snow: 'Snow' } as const
const EVENT = { none: null, exam_week: 'Exam week', home_game: 'Home game', move_in: 'Move-in' } as const

/** The big clock in the map's top-left corner. Re-renders once per simulated minute. */
export function Clock({ scenario, concept, busy }: { scenario: Scenario; concept: Concept; busy: boolean }) {
  const minute = usePlayhead((s) => Math.floor(s.t))
  const open = openWindow(concept, scenario.day)
  const isOpen = open !== null && minute >= open[0] && minute < open[1]
  const extras = [WEATHER[scenario.weather], EVENT[scenario.event]].filter(Boolean)
  return (
    <div className="pointer-events-none absolute top-3 left-4 z-10 select-none">
      <div className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-white tabular-nums">
        {clockLabel(minute)}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px] leading-none text-neutral-400">
        <span>{[scenario.day, ...extras].join(' · ')}</span>
        <span className={isOpen ? 'text-neutral-200' : 'text-neutral-500'}>{isOpen ? 'Open' : 'Closed'}</span>
      </div>
      {busy && (
        // .dark flips the Beautiful UI tokens so the loader reads on the dark map.
        <div className="dark mt-2.5">
          <LoadingState label="Simulating" />
        </div>
      )}
    </div>
  )
}

const SLOTS = Array.from({ length: 24 }, (_, i) => i)
const TICKS = [0, 6, 12, 18, 24]

/** Play button, a scrubber drawn as the hourly order histogram, and the running order count. */
export function TimeBar({ prediction, color }: { prediction: Prediction | null; color: RGB }) {
  const t = usePlayhead((s) => s.t)
  const playing = usePlayhead((s) => s.playing)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const bySlot = SLOTS.map((slot) => prediction?.byHour.find((b) => hourSlot(b.hour) === slot)?.p50 ?? 0)
  const max = Math.max(1, ...bySlot)
  const count = prediction ? Math.floor(ordersSoFar(prediction, t, hourSlot)) : 0
  const x = t / DAY_MINUTES

  const seekTo = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    usePlayhead.getState().seek(((clientX - r.left) / r.width) * DAY_MINUTES)
  }

  return (
    <div className="flex h-14 items-center gap-3 border-t border-white/8 px-3" style={{ background: 'rgb(18 18 19)' }}>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => usePlayhead.getState().toggle()}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-neutral-950 transition-transform duration-100 active:scale-[0.94]"
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
                  background: v > 0 ? (past ? css(color, 0.9) : 'rgb(255 255 255 / 0.16)') : 'rgb(255 255 255 / 0.07)',
                }}
              />
            )
          })}
          <span
            className="pointer-events-none absolute -top-1 -bottom-0.5 w-0.5 rounded-full bg-white"
            style={{ left: `calc(${x * 100}% - 1px)` }}
          />
        </div>
        <div className="relative h-3 text-[10.5px] leading-none text-neutral-500 tabular-nums">
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

      <div className="flex w-[92px] shrink-0 items-baseline justify-end gap-1.5">
        <span className="size-2 shrink-0 self-center rounded-full" style={{ background: css(color) }} />
        <span className="text-[20px] leading-none font-semibold text-white tabular-nums">{count}</span>
        <span className="text-[12px] text-neutral-400">orders</span>
      </div>
    </div>
  )
}
