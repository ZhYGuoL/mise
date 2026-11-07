import type { Map as MapLibre } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { int, shortName } from '../lib/format'
import type { Scene } from './layers'

/** Label geometry, in px. Keep in step with the classes below. */
const LOST = { h: 20, pad: 12, gap: 6, maxName: 150, size: 11.5 }
const NAME = { h: 24, pad: 16, size: 12 }
/** Dot radius plus outline, as drawn in layers.ts. Labels sit a small gap beyond it. */
const CONCEPT_DOT = 6.5 + 2
const LOST_DOT = 3.5 + 1.5
/** Labels keep this far from the map's edge and from each other. */
const INSET = 6
const MARGIN = 3

type Box = { x: number; y: number; w: number; h: number }

const hits = (a: Box, b: Box) =>
  a.x < b.x + b.w + MARGIN && b.x < a.x + a.w + MARGIN && a.y < b.y + b.h + MARGIN && b.y < a.y + a.h + MARGIN

const inside = (a: Box, width: number, height: number) =>
  a.x >= INSET && a.y >= INSET && a.x + a.w <= width - INSET && a.y + a.h <= height - INSET

const dotBox = (x: number, y: number, r: number): Box => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r })

let canvas: CanvasRenderingContext2D | null = null
/** Width of a string in the page font. */
function textWidth(text: string, weight: number, size: number) {
  canvas ??= document.createElement('canvas').getContext('2d')
  if (!canvas) return text.length * size * 0.56
  canvas.font = `${weight} ${size}px "Geist Variable", ui-sans-serif, system-ui, sans-serif`
  return Math.ceil(canvas.measureText(text).width)
}

/** Spots around a dot, best first: right, left, above, below. */
function spots(x: number, y: number, w: number, h: number, r: number): Box[] {
  return [
    { x: x + r, y: y - h / 2, w, h },
    { x: x - r - w, y: y - h / 2, w, h },
    { x: x - w / 2, y: y - r - h, w, h },
    { x: x - w / 2, y: y + r, w, h },
  ]
}

type Lost = Scene['stolen'][number] & { x: number; y: number; w: number; nameW: number }

/**
 * Put the concept's label, then each lost-order label, at the first spot that stays inside the map
 * and clear of the other labels and dots. fit is false when a lost-order label has no such spot.
 */
function layout(map: MapLibre, scene: Scene, conceptName: string) {
  const { width, height } = map.getContainer().getBoundingClientRect()
  const c = map.project(scene.concept)
  const lost: Lost[] = [...scene.stolen]
    .sort((a, b) => b.ordersLost - a.ordersLost)
    .map((s) => {
      const p = map.project([s.lon, s.lat])
      const nameW = Math.min(textWidth(shortName(s.name), 400, LOST.size), LOST.maxName)
      const w = LOST.pad + textWidth(`-${int(s.ordersLost)}`, 500, LOST.size) + LOST.gap + nameW
      return { ...s, x: p.x, y: p.y, w, nameW }
    })

  const dots = [dotBox(c.x, c.y, CONCEPT_DOT), ...lost.map((s) => dotBox(s.x, s.y, LOST_DOT))]
  const placed: Box[] = []
  const pick = (options: Box[], own: number) => {
    const clear = (b: Box) => !placed.some((p) => hits(b, p)) && !dots.some((d, i) => i !== own && hits(b, d))
    const best = options.find((b) => clear(b) && inside(b, width, height))
    const box = best ?? options.find(clear) ?? options[0]
    placed.push(box)
    return { box, ok: best !== undefined }
  }

  const nameW = NAME.pad + textWidth(conceptName, 600, NAME.size)
  const concept = pick(spots(c.x, c.y, nameW, NAME.h, CONCEPT_DOT + 4), 0).box
  const labels = lost.map((s, i) => ({ s, ...pick(spots(s.x, s.y, s.w, LOST.h, LOST_DOT + 3), i + 1) }))
  return { concept, labels, fit: labels.every((l) => l.ok) }
}

/** Re-render when the map moves, so screen positions follow the camera. */
function useMapView(map: MapLibre) {
  const [, setTick] = useState(0)
  useEffect(() => {
    let raf = 0
    const bump = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setTick((n) => n + 1))
    }
    map.on('move', bump)
    map.on('resize', bump)
    map.on('load', bump)
    void document.fonts.ready.then(bump)
    return () => {
      cancelAnimationFrame(raf)
      map.off('move', bump)
      map.off('resize', bump)
      map.off('load', bump)
    }
  }, [map])
}

/**
 * Whether the lost-order labels fit at their restaurants. Decided again on new data, a zoom or a
 * resize, but not on a pan, so dragging the map never moves the list in and out under it.
 */
function useFit(map: MapLibre, scene: Scene, conceptName: string, onFit: (fit: boolean) => void) {
  useEffect(() => {
    const decide = () => onFit(layout(map, scene, conceptName).fit)
    decide()
    map.on('zoomend', decide)
    map.on('resize', decide)
    void document.fonts.ready.then(decide)
    return () => {
      map.off('zoomend', decide)
      map.off('resize', decide)
    }
  }, [map, scene, conceptName, onFit])
}

/** The concept's name, and each restaurant it takes customers from, labeled at the restaurant. */
export function MapLabels({
  map,
  scene,
  conceptName,
  showLost,
  onFit,
}: {
  map: MapLibre
  scene: Scene
  conceptName: string
  showLost: boolean
  onFit: (fit: boolean) => void
}) {
  useMapView(map)
  useFit(map, scene, conceptName, onFit)
  const { concept, labels } = layout(map, scene, conceptName)

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {showLost &&
        labels.map(({ s, box }) => (
          <div
            key={s.placeId}
            className="absolute flex h-5 items-center gap-1.5 rounded-chip bg-surface px-1.5 text-[11.5px] leading-none whitespace-nowrap shadow-[0_0_0_1px_var(--line-strong)]"
            style={{ left: box.x, top: box.y }}
          >
            <span className="font-medium text-red tabular-nums">-{int(s.ordersLost)}</span>
            <span className="truncate text-ink-2" style={{ maxWidth: LOST.maxName }}>
              {shortName(s.name)}
            </span>
          </div>
        ))}

      <div
        className="absolute flex h-6 items-center rounded-chip bg-surface px-2 text-[12px] leading-none font-semibold whitespace-nowrap text-ink shadow-[0_0_0_1px_var(--line-strong)]"
        style={{ left: concept.x, top: concept.y }}
      >
        {conceptName}
      </div>
    </div>
  )
}
