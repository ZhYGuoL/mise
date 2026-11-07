import type { Concept, Prediction } from '@mise/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { int } from '../lib/format'
import { usePlayhead } from '../lib/playhead'
import { DAY_MINUTES, DAY_START_HOUR, hourLabel, hourSlot, openWindow } from '../lib/time'

const HEIGHT = 150
const PAD = { top: 18, bottom: 20 }
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21]
/**
 * The uncertainty band fades out from p50. A base layer marks the full p10 to p90 range, then thin
 * layers narrowing toward p50 stack up density. Steps are too small to read as quantile edges.
 */
const BAND_LAYERS = [
  { f: 1, opacity: 0.08 },
  ...Array.from({ length: 12 }, (_, k) => ({ f: 1 - (k + 1) / 13, opacity: 0.025 })),
]

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** A round step for the y gridlines. */
function niceStep(max: number) {
  const raw = max / 3
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
}

/** Readout for the hour under the playhead. Re-renders once per simulated hour. */
function Readout({ prediction }: { prediction: Prediction }) {
  const slot = usePlayhead((s) => Math.min(23, Math.floor(s.t / 60)))
  const hour = (slot + DAY_START_HOUR) % 24
  const b = prediction.byHour.find((x) => x.hour === hour)
  const busy = prediction.observedByHour?.find((x) => x.hour === hour)
  return (
    <span className="flex items-baseline gap-2 text-[11.5px] text-ink-3 tabular-nums">
      <span className="font-medium text-ink">{`${String(hour).padStart(2, '0')}:00`}</span>
      {b && b.p90 > 0 ? (
        <>
          <span className="text-ink-2">{int(b.p50)} orders</span>
          <span>
            {int(b.p10)} to {int(b.p90)}
          </span>
        </>
      ) : (
        <span>No orders</span>
      )}
      {busy && <span>Google busy {Math.round(busy.busyPct)}%</span>}
    </span>
  )
}

/** Vertical playhead plus the clip that colors the p50 line up to it. */
function Playhead({ width, clipId, height }: { width: number; clipId: string; height: number }) {
  const t = usePlayhead((s) => s.t)
  const x = (t / DAY_MINUTES) * width
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={x} height={height} />
        </clipPath>
      </defs>
      <line x1={x} x2={x} y1={PAD.top - 8} y2={height - PAD.bottom} stroke="var(--ink-2)" strokeWidth={1} />
    </>
  )
}

/** Orders by hour: p10 to p90 band, p50 line, closed hours shaded. Clicking seeks the time-lapse. */
export function HourChart({
  prediction,
  concept,
  color,
  busy,
}: {
  prediction: Prediction
  concept: Concept
  color: string
  busy: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const clipId = `hour-clip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const dragging = useRef(false)

  const slots = Array.from({ length: 24 }, (_, slot) => {
    const b = prediction.byHour.find((x) => hourSlot(x.hour) === slot)
    return { slot, p10: b?.p10 ?? 0, p50: b?.p50 ?? 0, p90: b?.p90 ?? 0 }
  })
  const maxV = Math.max(1, ...slots.map((s) => s.p90))
  const step = niceStep(maxV)
  const top = Math.ceil(maxV / step) * step
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (slot: number) => ((slot * 60 + 30) / DAY_MINUTES) * width
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH

  // Extend the first and last points to the edges so the lines span the full day.
  const pts = (value: (s: (typeof slots)[number]) => number) => [
    [0, y(value(slots[0]))],
    ...slots.map((s) => [x(s.slot), y(value(s))]),
    [width, y(value(slots[23]))],
  ]
  const line = (p: number[][]) => p.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  /** The band from p50 out to fraction f of the way to p10 and p90. */
  const band = (f: number) =>
    `${line(pts((s) => s.p50 + f * (s.p90 - s.p50)))}${pts((s) => s.p50 - f * (s.p50 - s.p10))
      .reverse()
      .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`)
      .join('')}Z`
  const p50 = line(pts((s) => s.p50))

  // Lane H: Google's busy curve for a real place. It is relative foot traffic, not orders,
  // so it is scaled to put its peak on the simulated p50 peak. Hours Google has no value for are gaps.
  const observed = prediction.observedByHour ?? []
  const observedMax = Math.max(0, ...observed.map((o) => o.busyPct))
  const p50Max = Math.max(0, ...slots.map((s) => s.p50))
  const google =
    observed.length && observedMax > 0 && p50Max > 0
      ? slots
          .map((s) => {
            const o = observed.find((x) => hourSlot(x.hour) === s.slot)
            return o ? { slot: s.slot, v: (o.busyPct / observedMax) * p50Max } : null
          })
          .reduce((d, o, i, all) => {
            if (!o) return d
            const cmd = all[i - 1] ? 'L' : 'M'
            return `${d}${cmd}${x(o.slot).toFixed(1)},${y(o.v).toFixed(1)}`
          }, '')
      : ''
  const r = prediction.observedCorrelation

  const open = openWindow(concept, prediction.scenario.day)
  const closed: [number, number][] = open
    ? ([[0, open[0]], [open[1], DAY_MINUTES]] as [number, number][]).filter(([a, b]) => b - a > 0)
    : [[0, DAY_MINUTES]]

  const peak = slots.reduce((a, b) => (b.p50 > a.p50 ? b : a), slots[0])
  const gridValues = Array.from({ length: Math.round(top / step) }, (_, i) => (i + 1) * step)

  const seek = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    usePlayhead.getState().seek(((clientX - r.left) / r.width) * DAY_MINUTES)
  }

  return (
    <div className="rounded-card bg-surface p-3 shadow-hairline transition-opacity duration-150" style={{ opacity: busy ? 0.45 : 1 }}>
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-[13px] font-semibold text-ink">Orders by hour</span>
        <span className="flex items-center gap-3 text-[11.5px] text-ink-3">
          {google && (
            <span className="flex items-center gap-1.5">
              <span className="h-px w-3 bg-ink-2" />
              Google busy
              {r != null && (
                <span className="tabular-nums text-ink-2" title="Correlation of simulated orders and Google busy, open hours">
                  r {r.toFixed(2)}
                </span>
              )}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
            p50
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-3 rounded-[2px]"
              style={{ background: `linear-gradient(to bottom, transparent, ${color}, transparent)`, opacity: 0.4 }}
            />
            p10 to p90
          </span>
        </span>
      </div>
      <div className="mt-2 overflow-hidden rounded-control bg-inset shadow-hairline">
        <div className="flex h-7 items-center border-b border-line px-2.5">
          <Readout prediction={prediction} />
        </div>
        <div
          ref={ref}
          className="relative cursor-pointer touch-none select-none"
          style={{ height: HEIGHT }}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            usePlayhead.getState().pause()
            seek(e.clientX, e.currentTarget)
          }}
          onPointerMove={(e) => dragging.current && seek(e.clientX, e.currentTarget)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          {width > 0 && (
            <svg width={width} height={HEIGHT} className="absolute inset-0 block">
              {closed.map(([a, b]) => (
                <g key={a}>
                  <rect
                    x={(a / DAY_MINUTES) * width}
                    y={0}
                    width={((b - a) / DAY_MINUTES) * width}
                    height={HEIGHT - PAD.bottom}
                    fill="var(--hover-2)"
                    opacity={0.55}
                  />
                  {((b - a) / DAY_MINUTES) * width > 56 && (
                    <text x={(a / DAY_MINUTES) * width + 6} y={13} fontSize={10.5} fill="var(--ink-3)">
                      Closed
                    </text>
                  )}
                </g>
              ))}
              {gridValues.map((v) => (
                <g key={v}>
                  <line x1={0} x2={width} y1={y(v)} y2={y(v)} stroke="var(--line-strong)" strokeDasharray="2 3" />
                  <text x={width - 6} y={y(v) - 3} fontSize={10.5} fill="var(--ink-3)" textAnchor="end" className="tabular-nums">
                    {int(v)}
                  </text>
                </g>
              ))}
              {BAND_LAYERS.map(({ f, opacity }) => (
                <path key={f} d={band(f)} fill={color} opacity={opacity} />
              ))}
              {google && (
                <path d={google} fill="none" stroke="var(--ink-2)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
              )}
              <path d={p50} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.75} strokeLinejoin="round" />
              <Playhead width={width} clipId={clipId} height={HEIGHT} />
              <path
                d={p50}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                clipPath={`url(#${clipId})`}
              />
              {peak.p50 > 0 && (
                <g>
                  <circle cx={x(peak.slot)} cy={y(peak.p50)} r={3} fill={color} />
                  <text
                    x={x(peak.slot)}
                    y={y(peak.p90) - 5}
                    fontSize={11}
                    fontWeight={600}
                    fill="var(--ink)"
                    textAnchor="middle"
                    className="tabular-nums"
                  >
                    {int(peak.p50)}
                  </text>
                </g>
              )}
              {TICKS.map((slot) => (
                <text
                  key={slot}
                  x={(slot / 24) * width + (slot === 0 ? 6 : 0)}
                  y={HEIGHT - 6}
                  fontSize={10.5}
                  fill="var(--ink-3)"
                  textAnchor={slot === 0 ? 'start' : 'middle'}
                >
                  {hourLabel(slot + DAY_START_HOUR)}
                </text>
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
