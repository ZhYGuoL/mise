import type { Concept } from "@mise/shared";

/**
 * Candidate storefront sites. The model picks a site id, code fills the address and lat/lon.
 * Coordinates come from the real restaurants in data/raw/restaurants.csv on the same block.
 */
export type Site = Concept["location"] & { id: string };

export const SITES: Site[] = [
  {
    id: "oakland-forbes-craig",
    address: "Forbes Ave near S Craig St, Pittsburgh, PA 15213",
    neighborhood: "North Oakland",
    lat: 40.44415,
    lon: -79.94895,
  },
  {
    id: "oakland-forbes-bouquet",
    address: "Forbes Ave near S Bouquet St, Pittsburgh, PA 15213",
    neighborhood: "Central Oakland",
    lat: 40.44175,
    lon: -79.9568,
  },
  {
    id: "oakland-atwood",
    address: "Atwood St, 300 block, Pittsburgh, PA 15213",
    neighborhood: "Central Oakland",
    lat: 40.439,
    lon: -79.9553,
  },
  {
    id: "shadyside-walnut-aiken",
    address: "Walnut St near S Aiken Ave, Pittsburgh, PA 15232",
    neighborhood: "Shadyside",
    lat: 40.451,
    lon: -79.9338,
  },
  {
    id: "shadyside-highland",
    address: "S Highland Ave, 200 block, Pittsburgh, PA 15206",
    neighborhood: "Shadyside",
    lat: 40.4579,
    lon: -79.9251,
  },
  {
    id: "east-liberty-highland",
    address: "S Highland Ave, 100 block, Pittsburgh, PA 15206",
    neighborhood: "East Liberty",
    lat: 40.4602,
    lon: -79.9252,
  },
  {
    id: "squirrel-hill-forbes-murray",
    address: "Forbes Ave near Murray Ave, Pittsburgh, PA 15217",
    neighborhood: "Squirrel Hill North",
    lat: 40.4383,
    lon: -79.9222,
  },
  {
    id: "squirrel-hill-forbes-shady",
    address: "Forbes Ave near Shady Ave, Pittsburgh, PA 15217",
    neighborhood: "Squirrel Hill North",
    lat: 40.4379,
    lon: -79.9194,
  },
];

export const siteById = (id: string) => SITES.find((s) => s.id === id);

/** The site a location sits on, if it is one of ours. */
export const siteOf = (loc: { lat: number; lon: number }) =>
  SITES.find((s) => Math.abs(s.lat - loc.lat) < 1e-4 && Math.abs(s.lon - loc.lon) < 1e-4);

export function toLocation(site: Site): Concept["location"] {
  const { id: _id, ...location } = site;
  return location;
}
