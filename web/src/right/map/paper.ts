import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import { MAP, type RGB } from '../lib/color'

const rgb = ([r, g, b]: RGB) => `rgb(${r}, ${g}, ${b})`

const LINES: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const NOT_TUNNEL: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel']

/**
 * A light "paper" basemap built on the OpenFreeMap tiles: land in the page canvas grey, water a
 * step darker, roads as hairlines, no labels. The city's data is the only thing that speaks.
 */
export const PAPER: StyleSpecification = {
  version: 8,
  sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': rgb(MAP.land) } },
    {
      id: 'water',
      type: 'fill',
      source: 'omt',
      'source-layer': 'water',
      filter: ['all', ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], NOT_TUNNEL],
      paint: { 'fill-color': rgb(MAP.water) },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'omt',
      'source-layer': 'waterway',
      filter: ['all', LINES, NOT_TUNNEL],
      paint: { 'line-color': rgb(MAP.water), 'line-width': 1 },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['all', LINES, NOT_TUNNEL, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': rgb(MAP.roadMinor), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1] },
    },
    {
      id: 'roads',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: [
        'all',
        LINES,
        NOT_TUNNEL,
        ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': rgb(MAP.road), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 16, 1.5] },
    },
  ],
}
