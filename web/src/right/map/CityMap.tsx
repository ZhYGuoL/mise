import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { PickingInfo } from '@deck.gl/core'
import type { Concept, Prediction, Resident, Restaurant } from '@mise/shared'
import { LngLatBounds, Map as MapLibre, setWorkerUrl } from 'maplibre-gl'
// Vite pre-bundles maplibre-gl, which breaks its default worker URL. Let Vite bundle the worker.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MAP, type RGB } from '../lib/color'
import type { Flow } from '../lib/flows'
import { usePlayhead } from '../lib/playhead'
import { buildLayers, type Scene } from './layers'
import { MapLabels } from './MapLabels'

const STYLE = 'https://tiles.openfreemap.org/styles/dark'

setWorkerUrl(workerUrl)

type Props = {
  concept: Concept
  color: RGB
  restaurants: Restaurant[]
  residents: Resident[]
  flows: Flow[]
  stolen: Prediction['stolenFrom']
  selected: Resident | null
  selectedFlow: Flow | null
  onSelectResident: (id: string | null) => void
  children?: React.ReactNode
}

/** Quiet the basemap so the city's data reads first. */
function tuneBasemap(map: MapLibre) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith('road_oneway')) map.setLayoutProperty(layer.id, 'visibility', 'none')
    if (layer.type === 'symbol' && layer.id.startsWith('highway_name')) {
      map.setPaintProperty(layer.id, 'text-opacity', 0.45)
    }
  }
}

export function CityMap({
  concept,
  color,
  restaurants,
  residents,
  flows,
  stolen,
  selected,
  selectedFlow,
  onSelectResident,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibre | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const dirtyRef = useRef(true)
  const selectRef = useRef(onSelectResident)
  const initialCenter = useRef<[number, number]>([concept.location.lon, concept.location.lat])

  const scene = useMemo<Scene>(
    () => ({
      concept: [concept.location.lon, concept.location.lat],
      color,
      restaurants,
      residents,
      flows,
      stolen,
      selected,
      selectedFlow,
    }),
    [concept.location.lon, concept.location.lat, color, restaurants, residents, flows, stolen, selected, selectedFlow],
  )

  useEffect(() => {
    sceneRef.current = scene
    dirtyRef.current = true
  }, [scene])

  useEffect(() => {
    selectRef.current = onSelectResident
  }, [onSelectResident])

  // Create the map and the deck.gl overlay once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const m = new MapLibre({
      container,
      style: STYLE,
      center: initialCenter.current,
      zoom: 13.8,
      attributionControl: { compact: true },
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    m.touchZoomRotate.disableRotation()
    m.on('load', () => {
      tuneBasemap(m)
      // Start the compact attribution collapsed. It stays one click away.
      container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
    })
    if (import.meta.env.DEV) {
      const errors: string[] = []
      m.on('error', (e) => errors.push(String(e.error?.message ?? e)))
      Object.assign(window, { __miseMap: m, __miseMapErrors: errors })
    }

    const overlay = new MapboxOverlay({
      interleaved: false,
      pickingRadius: 6,
      layers: [],
      onClick: (info: PickingInfo) => {
        if (info.layer?.id === 'residents' && info.object) selectRef.current((info.object as Resident).id)
      },
      onHover: (info: PickingInfo) => {
        m.getCanvas().style.cursor = info.layer?.id === 'residents' && info.object ? 'pointer' : ''
      },
    })
    m.addControl(overlay)
    overlayRef.current = overlay
    setMap(m)

    // Redraw on every frame where the clock or the scene changed.
    let raf = 0
    let lastT = -1
    const frame = () => {
      const t = usePlayhead.getState().t
      const s = sceneRef.current
      if (s && (t !== lastT || dirtyRef.current)) {
        overlay.setProps({ layers: buildLayers(s, t) })
        lastT = t
        dirtyRef.current = false
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      overlayRef.current = null
      m.remove()
      setMap(null)
    }
    // The map is created once. Concept moves are handled below.
  }, [])

  // Frame the neighborhood once the restaurants arrive.
  const framed = useRef(false)
  useEffect(() => {
    if (!map || framed.current || restaurants.length === 0) return
    // Frame the central 90% of restaurants, so one outlier does not shrink the neighborhood.
    const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]
    const lons = restaurants.map((r) => r.lon)
    const lats = restaurants.map((r) => r.lat)
    const bounds = new LngLatBounds([q(lons, 0.05), q(lats, 0.05)], [q(lons, 0.95), q(lats, 0.95)])
    bounds.extend([concept.location.lon, concept.location.lat])
    map.fitBounds(bounds, { padding: { top: 72, bottom: 28, left: 28, right: 28 }, duration: 0 })
    framed.current = true
  }, [map, restaurants, concept.location.lon, concept.location.lat])

  // Keep the concept in view if the agent moves it.
  useEffect(() => {
    if (!map || !framed.current) return
    const at: [number, number] = [concept.location.lon, concept.location.lat]
    if (!map.getBounds().contains(at)) map.easeTo({ center: at, duration: 600 })
  }, [map, concept.location.lon, concept.location.lat])

  return (
    <div className="mise-map relative h-full w-full overflow-hidden" style={{ background: MAP.background }}>
      {/* MapLibre sets position: relative on its container, so size it with h-full, not inset-0. */}
      <div ref={containerRef} className="h-full w-full" />
      {map && <MapLabels map={map} scene={scene} conceptName={concept.name} />}
      {children}
    </div>
  )
}
