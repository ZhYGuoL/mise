import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * Light basemap on the OpenFreeMap tiles. Three variants (`?map=a|b|c`, default a):
 *   a  "Streets":  grey land, white streets with a grey edge (classic light map), parks and water tinted
 *   b  "Drawn":    near-white land, streets as dark grey lines by class, buildings as faint blocks
 *   c  "Drawn + places": b plus neighborhood names (Oakland, Shadyside...) so the city is readable
 */
export type MapVariant = 'a' | 'b' | 'c'
export const mapVariant = (): MapVariant => {
  const v = new URLSearchParams(location.search).get('map')
  return v === 'b' || v === 'c' ? v : 'a'
}

const LINES: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const POLYS: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const NOT_TUNNEL: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel']
const cls = (...c: string[]): ExpressionSpecification => ['match', ['get', 'class'], c, true, false]
const z = (a: number, b: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 12, a, 16, b]

const road = (id: string, classes: string[], color: string, width: ExpressionSpecification): LayerSpecification => ({
  id,
  type: 'line',
  source: 'omt',
  'source-layer': 'transportation',
  filter: ['all', LINES, NOT_TUNNEL, cls(...classes)],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': color, 'line-width': width },
})

const MAJOR = ['motorway', 'trunk', 'primary']
const MID = ['secondary', 'tertiary']
const MINOR = ['minor', 'service']

function layers(v: MapVariant): LayerSpecification[] {
  const streets = v === 'a'
  const land = streets ? '#e9ebee' : '#f6f6f7'
  const water = streets ? '#c9d3dd' : '#d9dee4'
  const park = streets ? '#dfe5dc' : '#eceeea'
  const out: LayerSpecification[] = [
    { id: 'land', type: 'background', paint: { 'background-color': land } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', filter: POLYS, paint: { 'fill-color': park } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['all', POLYS, NOT_TUNNEL], paint: { 'fill-color': water } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', filter: ['all', LINES, NOT_TUNNEL], paint: { 'line-color': water, 'line-width': 1.5 } },
  ]
  if (!streets) {
    out.push({ id: 'buildings', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#ebecee' } })
  }
  if (streets) {
    // white streets with a grey edge: casing first, fill on top
    out.push(
      road('minor-case', MINOR, '#d3d7dc', z(1.6, 4)),
      road('mid-case', MID, '#c4c9cf', z(2.6, 6.5)),
      road('major-case', MAJOR, '#b8bec5', z(3.4, 8.5)),
      road('minor', MINOR, '#ffffff', z(0.8, 2.6)),
      road('mid', MID, '#ffffff', z(1.6, 4.8)),
      road('major', MAJOR, '#ffffff', z(2.2, 6.5)),
    )
  } else {
    out.push(
      road('minor', MINOR, '#cdd1d6', z(0.6, 1.2)),
      road('mid', MID, '#a9afb7', z(0.9, 1.8)),
      road('major', MAJOR, '#8c939c', z(1.3, 2.6)),
    )
  }
  if (v === 'c' || labelsOn()) {
    out.push({
      id: 'places',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      filter: cls('suburb', 'neighbourhood', 'quarter', 'city', 'town', 'village', 'hamlet'),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
      },
      paint: { 'text-color': '#7a8089', 'text-halo-color': '#f6f6f7', 'text-halo-width': 1.5 },
    })
  }
  return out
}

const labelsOn = () => new URLSearchParams(location.search).get('labels') === '1'

export const paperStyle = (v: MapVariant = mapVariant()): StyleSpecification => ({
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: layers(v),
})

export const PAPER: StyleSpecification = paperStyle()
