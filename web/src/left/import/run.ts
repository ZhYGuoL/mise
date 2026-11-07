import type { AgentEvent, Concept, ImportPlace, ImportResponse } from '@mise/shared'
import { api } from '@/api'
import { useMise } from '@/state/store'
import { finish, handleEvent, startTurn } from '../client'
import { useSession } from '../session'
import { importRestaurant, ImportFailure } from './api'

/**
 * Lane H: `/import Noodlehead` (or a picked autocomplete row, or a Maps link).
 * The server returns a v1 Concept for the real place. The thread shows it like any agent turn:
 * the steps, "Created", the photos (lane B, cached) and the first simulated day.
 */

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const HOURS_SOURCE: Record<NonNullable<ImportResponse['hoursSource']>, string> = {
  google: 'Google popular times',
  osm: 'OpenStreetMap',
  default: 'Cuisine defaults',
}

function steps(res: ImportResponse): AgentEvent[] {
  const c = res.concept
  const e = c.existing
  const out: AgentEvent[] = [
    { type: 'thinking', label: c.name, detail: [c.location.address.split(',')[0], c.location.neighborhood].join(', ') },
  ]
  if (e?.rating != null) out.push({ type: 'thinking', label: 'Rating', detail: `${e.rating} from ${(e.reviews ?? 0).toLocaleString('en-US')} reviews` })
  out.push({
    type: 'thinking',
    label: 'Menu',
    detail:
      e?.menuSource === 'website' && e.websiteUrl
        ? `${c.menu.length} items from ${host(e.websiteUrl)}`
        : `${c.menu.length} items, estimated`,
  })
  if (res.hoursSource) out.push({ type: 'thinking', label: 'Hours', detail: HOURS_SOURCE[res.hoursSource] })
  return out
}

/** A new restaurant is a new history: the thread and the versions start over at its v1. */
function startOver(turnId: string) {
  useSession.setState((s) => {
    const i = s.turns.findIndex((t) => t.id === turnId)
    return { turns: s.turns.slice(Math.max(0, i - 1)), changed: [], generating: [] }
  })
  useMise.setState({ concept: null, versions: [], prediction: null, selectedResidentId: null })
}

/** Lane B's normal generation: cached by prompt, so a second import of the same place makes no new image. */
function photos(concept: Concept, emit: (e: AgentEvent) => void): Promise<unknown> {
  const targets = ['logo', ...concept.menu.map((m) => m.id)]
  return Promise.allSettled(
    targets.map(async (target) => {
      emit({ type: 'generating', target })
      const url =
        target === 'logo'
          ? (await api.generateLogo({ concept })).logoUrl
          : (await api.generateDish({ concept, itemId: target })).imageUrl
      if (url) emit({ type: 'generated', target, url })
    }),
  )
}

/** The server's picks for the last query it could not settle, so autocomplete offers exactly those. */
let offered: { query: string; places: ImportPlace[] } | null = null
export const offeredFor = (args: string) => (offered && offered.query === args.trim() ? offered.places : null)

/** A Maps link reads as "google.com/maps/place/Noodlehead" in the thread, not 300 characters of URL. */
function shortLink(q: string) {
  try {
    const u = new URL(q.startsWith('http') ? q : `https://${q}`)
    const path = u.pathname.split('/@')[0]!.replace(/\/data=.*$/, '').replace(/\+/g, ' ')
    const text = decodeURIComponent(`${u.hostname.replace(/^www\./, '')}${path}`)
    return text.length > 60 ? `${text.slice(0, 59)}…` : text
  } catch {
    return q.length > 60 ? `${q.slice(0, 59)}…` : q
  }
}

export const isLink = (s: string) => /^\s*(https?:\/\/|www\.|maps\.app|goo\.gl)/i.test(s)

export async function runImport(query: string, pick?: ImportPlace) {
  const q = (pick?.name ?? query).trim()
  if (!q || useSession.getState().busy) return
  const turnId = startTurn(`/import ${isLink(q) ? shortLink(q) : q}`)
  const ctx = { turnId, basePrediction: null }
  const emit = (e: AgentEvent) => handleEvent(e, ctx)
  let images: Promise<unknown> = Promise.resolve()

  emit({ type: 'thinking', label: 'Finding the restaurant', detail: isLink(q) ? shortLink(q) : q })
  try {
    const res = await importRestaurant({ query: q, placeId: pick?.placeId })
    startOver(turnId)
    for (const e of steps(res)) emit(e)
    emit({ type: 'concept', concept: res.concept })
    images = photos(res.concept, emit)

    const { scenario } = useMise.getState()
    emit({ type: 'simulating', scenario })
    try {
      emit({ type: 'prediction', prediction: await api.simulate({ concept: res.concept, scenario }) })
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  } catch (err) {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    // Two branches, or a close name: put the query back so autocomplete lists the places to pick from.
    if (err instanceof ImportFailure && err.suggestions.length) {
      offered = { query: q, places: err.suggestions }
      useSession.setState({ draft: `/import ${q}` })
    }
  }
  emit({ type: 'done' })
  await images
  finish(turnId)
}
