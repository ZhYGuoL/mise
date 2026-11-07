import type { Concept, ConceptEdit } from '@mise/shared'

/** Plain-word labels and values for concept paths, so diffs read like a menu, not like JSON. */

const FIELD: Record<string, string> = {
  name: 'Name',
  tagline: 'Tagline',
  cuisine: 'Cuisine',
  location: 'Location',
  priceTier: 'Price tier',
  deliveryFee: 'Delivery fee',
  serviceFeePct: 'Service fee',
  price: 'Price',
  description: 'Description',
  category: 'Category',
  tags: 'Tags',
  imagePrompt: 'Photo',
  open: 'Opens',
  close: 'Closes',
  voice: 'Voice',
  logoPrompt: 'Logo',
  primary: 'Primary color',
  background: 'Background color',
  ink: 'Ink color',
  discountPct: 'Discount',
  appliesTo: 'Applies to',
  days: 'Days',
  hours: 'Hours',
}

const words = (token: string) => token.replace(/_/g, ' ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const cuisineLabel = (tokens: string[]) => tokens.map((t) => cap(words(t))).join(' · ')

export const usd = (n: number) => `$${n.toFixed(2)}`

/** "02:00" -> "2 AM", "11:30" -> "11:30 AM" */
export function time12(hm: string) {
  const [h, m] = hm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

export const parsePath = (path: string) => path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))

export function pathLabel(path: string, concept: Concept): string {
  const [head, a, b, c] = parsePath(path)
  if (head === 'menu') {
    const item = a !== undefined && a !== '-' ? concept.menu[Number(a)] : undefined
    if (b === undefined) return item ? item.name : 'New dish'
    const field = FIELD[b] ?? cap(words(b))
    return `${item?.name ?? 'Dish'} · ${c !== undefined ? `${field}` : field}`
  }
  if (head === 'hours') return b ? `${a} · ${FIELD[b] ?? b}` : a ? `${a} hours` : 'Hours'
  if (head === 'brand') return a === 'colors' ? FIELD[b] ?? 'Colors' : `Brand ${FIELD[a]?.toLowerCase() ?? a}`
  if (head === 'promos') return 'Promo'
  return FIELD[head] ?? cap(words(head))
}

/** Label for one edit. A whole dish added or removed says so, and its value carries the name. */
export function editLabel(e: ConceptEdit, concept: Concept): string {
  const [head, , field] = parsePath(e.path)
  if (head === 'menu' && field === undefined && e.op !== 'replace') return e.op === 'add' ? 'New dish' : 'Dish removed'
  return pathLabel(e.path, concept)
}

type Hours = { open: string; close: string } | null

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** A whole week of hours in one line: "Daily 12 PM to 10 PM", or "Mon to Thu 11 AM to 10 PM, Fri to Sun 11 AM to 2 AM". */
function weekHours(week: Record<string, Hours>): string {
  const groups: { from: string; to: string; text: string }[] = []
  for (const day of WEEK) {
    const h = week[day]
    const text = h ? `${time12(h.open)} to ${time12(h.close)}` : 'Closed'
    const g = groups.at(-1)
    if (g && g.text === text) g.to = day
    else groups.push({ from: day, to: day, text })
  }
  if (groups.length === 1) return `Daily ${groups[0].text}`
  return groups.map((g) => `${g.from.slice(0, 3)}${g.to === g.from ? '' : ` to ${g.to.slice(0, 3)}`} ${g.text}`).join(', ')
}

export function formatValue(path: string, value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return parsePath(path)[0] === 'hours' ? 'Closed' : 'None'
  const last = parsePath(path).at(-1) ?? ''
  if (typeof value === 'number') {
    if (last === 'price' || last === 'deliveryFee') return usd(value)
    if (last === 'serviceFeePct' || last === 'discountPct') return `${value}%`
    if (last === 'priceTier') return '$'.repeat(value)
    return String(value)
  }
  if (typeof value === 'string') {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return time12(value)
    return words(value)
  }
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? words(v) : formatValue(path, v))).join(', ')
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if ('open' in o && 'close' in o) {
      const h = o as Exclude<Hours, null>
      return `${time12(h.open)} to ${time12(h.close)}`
    }
    if (WEEK.every((d) => d in o)) return weekHours(o as Record<string, Hours>)
    if ('address' in o) return String(o.address)
    if ('name' in o && 'price' in o) return `${o.name} · ${usd(Number(o.price))}`
    if ('description' in o) return String(o.description)
  }
  return JSON.stringify(value)
}

/** Edits between two versions, for the version diff. Code-managed fields are left out. */
export function diffConcepts(a: Concept, b: Concept): ConceptEdit[] {
  const out: ConceptEdit[] = []
  const IGNORE = new Set(['id', 'version', 'imageUrl', 'logoUrl'])
  const LEAF = [/^\/hours\/\w+$/, /^\/location$/, /^\/cuisine$/, /^\/menu\/\d+\/tags$/, /^\/promos\/\d+$/]
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)

  const walk = (x: unknown, y: unknown, path: string) => {
    if (same(x, y)) return
    const leaf = LEAF.some((re) => re.test(path))
    const bothObjects = x && y && typeof x === 'object' && typeof y === 'object'
    if (!leaf && bothObjects && Array.isArray(x) === Array.isArray(y)) {
      if (path === '/menu') {
        // Dishes match by id, so removing one does not make every dish after it look changed.
        // Paths of kept and new dishes use their index in the newer version, removed ones their old index.
        const xs = x as { id: string }[]
        const ys = y as { id: string }[]
        xs.forEach((item, i) => {
          if (!ys.some((o) => o.id === item.id)) out.push({ op: 'remove', path: `/menu/${i}`, previous: item, reason: '' })
        })
        ys.forEach((item, j) => {
          const old = xs.find((o) => o.id === item.id)
          if (old) walk(old, item, `/menu/${j}`)
          else out.push({ op: 'add', path: `/menu/${j}`, value: item, reason: '' })
        })
        return
      }
      if (Array.isArray(x) && Array.isArray(y)) {
        const n = Math.max(x.length, y.length)
        for (let i = 0; i < n; i++) {
          const p = `${path}/${i}`
          if (i >= x.length) out.push({ op: 'add', path: p, value: y[i], reason: '' })
          else if (i >= y.length) out.push({ op: 'remove', path: p, previous: x[i], reason: '' })
          else walk(x[i], y[i], p)
        }
        return
      }
      const keys = new Set([...Object.keys(x as object), ...Object.keys(y as object)])
      for (const k of keys) {
        if (IGNORE.has(k)) continue
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}/${k}`)
      }
      return
    }
    out.push({ op: x === undefined ? 'add' : y === undefined ? 'remove' : 'replace', path, previous: x, value: y, reason: '' })
  }
  walk(a, b, '')
  return out
}

/** Menu item ids touched by a set of edits, for the canvas highlight. */
export function touchedItems(edits: ConceptEdit[], concept: Concept): string[] {
  const ids = new Set<string>()
  for (const e of edits) {
    const [head, i] = parsePath(e.path)
    if (head !== 'menu' || e.op === 'remove') continue
    const item = i === '-' ? concept.menu.at(-1) : concept.menu[Number(i)]
    if (item) ids.add(item.id)
  }
  return [...ids]
}
