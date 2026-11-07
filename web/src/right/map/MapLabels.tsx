import type { Map as MapLibre } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { css, MAP } from '../lib/color'
import type { Scene } from './layers'

/** Drop a leading parenthetical, e.g. "(شاورما عمر) Omar's Halal Grill" -> "Omar's Halal Grill". */
const shortName = (name: string) => name.replace(/^\([^)]*\)\s*/, '')

const ROW = 24
const OFFSET = 56

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
    return () => {
      cancelAnimationFrame(raf)
      map.off('move', bump)
      map.off('resize', bump)
      map.off('load', bump)
    }
  }, [map])
}

/**
 * Direct labels on the map: the concept's name, and each restaurant it takes orders from with
 * the number lost. Those restaurants sit a few blocks from the concept, so their labels stack in
 * a column beside it with a leader line to each dot.
 */
export function MapLabels({ map, scene, conceptName }: { map: MapLibre; scene: Scene; conceptName: string }) {
  useMapView(map)
  const { width } = map.getContainer().getBoundingClientRect()
  const c = map.project(scene.concept)

  const lost = scene.stolen
    .map((s) => ({ ...s, p: map.project([s.lon, s.lat]) }))
    .sort((a, b) => a.p.y - b.p.y)
  const lostOnLeft = c.x > 260 || c.x > width - 200
  const n = lost.length
  const columnX = lostOnLeft ? c.x - OFFSET : c.x + OFFSET

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full">
        {lost.map((s, i) => {
          const y = c.y + (i - (n - 1) / 2) * ROW
          return (
            <line
              key={s.placeId}
              x1={columnX}
              y1={y}
              x2={s.p.x}
              y2={s.p.y}
              stroke={css(MAP.lost, 0.45)}
              strokeWidth={1}
            />
          )
        })}
      </svg>

      {lost.map((s, i) => {
        const y = c.y + (i - (n - 1) / 2) * ROW
        return (
          <div
            key={s.placeId}
            className="absolute flex h-5 max-w-44 items-center gap-1.5 rounded-chip px-1.5 text-[11.5px] leading-none whitespace-nowrap"
            style={{
              left: columnX,
              top: y,
              transform: `translate(${lostOnLeft ? '-100%' : '0'}, -50%)`,
              background: 'rgb(28 28 30)',
              boxShadow: '0 0 0 1px rgb(255 255 255 / 0.08)',
            }}
          >
            <span className="font-medium tabular-nums" style={{ color: css(MAP.lost) }}>
              -{Math.round(s.ordersLost)}
            </span>
            <span className="truncate text-neutral-300">{shortName(s.name)}</span>
          </div>
        )
      })}

      <div
        className="absolute flex h-6 items-center gap-1.5 rounded-chip px-2 text-[12.5px] leading-none font-semibold whitespace-nowrap text-white"
        style={{
          left: lostOnLeft ? c.x + 14 : c.x - 14,
          top: c.y,
          transform: `translate(${lostOnLeft ? '0' : '-100%'}, -50%)`,
          background: 'rgb(28 28 30)',
          boxShadow: `0 0 0 1px ${css(scene.color, 0.55)}`,
        }}
      >
        {conceptName}
      </div>
    </div>
  )
}
