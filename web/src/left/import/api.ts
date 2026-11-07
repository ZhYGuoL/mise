import { ImportError, ImportPlace, ImportResponse, type ImportRequest } from '@mise/shared'
import { z } from 'zod'
import { api } from '@/api'

/** Lane H: the import endpoints. A no-match comes back as ImportFailure with the server's words and suggestions. */

export class ImportFailure extends Error {
  readonly suggestions: ImportPlace[]
  constructor(message: string, suggestions: ImportPlace[]) {
    super(message)
    this.suggestions = suggestions
  }
}

export async function importRestaurant(body: ImportRequest, signal?: AbortSignal): Promise<ImportResponse> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const json: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = ImportError.safeParse(json)
    throw new ImportFailure(err.success ? err.data.error : `Import failed (${res.status})`, err.success ? (err.data.suggestions ?? []) : [])
  }
  return ImportResponse.parse(json)
}

let places: Promise<ImportPlace[]> | null = null
let loaded: ImportPlace[] = []

/** Every city restaurant, most reviewed first. Falls back to /api/city/restaurants (no streets) if the import route is down. */
export function loadPlaces(): Promise<ImportPlace[]> {
  places ??= fetch('/api/import/places')
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status))
      return z.array(ImportPlace).parse(await res.json())
    })
    .catch(async () =>
      (await api.cityRestaurants())
        .map((r) => ({ ...r, street: null, neighborhood: null }))
        .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0)),
    )
    .then((list) => (loaded = list))
    .catch(() => {
      places = null
      return []
    })
  return places
}

/** What has loaded so far. Autocomplete reads this on every keystroke. */
export const placesNow = () => loaded
