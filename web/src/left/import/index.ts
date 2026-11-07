import type { ImportPlace } from '@mise/shared'
import { registerCommand, type Suggestion } from '../commands'
import { loadPlaces, placesNow } from './api'
import { isLink, offeredFor, runImport } from './run'

/** Lane H: registers `/import` with the composer. Import once. */

const MAX_ROWS = 6

const words = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Every typed word starts a word of the name, street or neighborhood. Name hits rank first, then reviews. */
function rank(args: string, places: ImportPlace[]): ImportPlace[] {
  const q = words(args)
  if (!q.length) return places.slice(0, MAX_ROWS)
  const scored: { p: ImportPlace; s: number }[] = []
  for (const p of places) {
    const name = [p.name, ...(p.aliases ?? [])].flatMap(words)
    const where = words(`${p.street ?? ''} ${p.neighborhood ?? ''}`)
    const compact = words(p.name).join('')
    let s = 0
    let ok = true
    for (const w of q) {
      if (name.some((n) => n.startsWith(w))) s += 2
      else if (where.some((n) => n.startsWith(w))) s += 1
      else if (compact.startsWith(q.join(''))) s += 2
      else ok = false
    }
    if (ok) scored.push({ p, s })
  }
  return scored.sort((a, b) => b.s - a.s || (b.p.reviews ?? 0) - (a.p.reviews ?? 0)).slice(0, MAX_ROWS).map((x) => x.p)
}

const row = (p: ImportPlace): Suggestion => ({
  key: p.placeId,
  label: p.name,
  detail: [p.street, p.neighborhood].filter(Boolean).join(', ') || undefined,
  run: () => runImport(p.name, p),
})

registerCommand({
  name: 'import',
  hint: 'Noodlehead or a Maps link',
  run: (args) => runImport(args),
  // Maps links go straight to the server.
  suggest: (args) => (isLink(args) ? [] : (offeredFor(args) ?? rank(args, placesNow())).map(row)),
})

// Load the 192 places now, so the list is there the first time the owner types "/import ".
void loadPlaces()

export { runImport } from './run'
export { loadPlaces } from './api'
