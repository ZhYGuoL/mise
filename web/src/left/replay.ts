import { AgentEvent, type Concept, type ConceptEdit, Prediction } from '@mise/shared'
import { z } from 'zod'
import { api } from '@/api'
import { useMise } from '@/state/store'
import fixture from '../../../data/fixtures/agent-events.json'
import fixturePrediction from '../../../data/fixtures/prediction.json'
import { finish, handleEvent, startTurn } from './client'
import { useSession } from './session'

/**
 * ?replay=1 plays the scripted session from data/fixtures/agent-events.json with real timing.
 * It needs no model. Photos and the city still come from the local server when it is up,
 * and approving the proposed edits goes through the normal apply path.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The fixture's v1 already carries the edits it proposes. Undo them so the diff is real. */
function undo(concept: Concept, edits: ConceptEdit[]): Concept {
  const doc = structuredClone(concept) as unknown as Record<string, unknown>
  for (const e of edits) {
    if (e.op !== 'replace') continue
    const keys = e.path.split('/').slice(1)
    let node = doc as Record<string, unknown>
    for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>
    node[keys.at(-1)!] = e.previous
  }
  return doc as unknown as Concept
}

export async function playReplay() {
  const events = z.array(AgentEvent).parse(fixture)
  const edits = events.find((e) => e.type === 'edits')
  const first = events.find((e) => e.type === 'concept')
  const idea = events.find((e) => e.type === 'thinking')?.detail ?? 'late-night Korean fried chicken near CMU, cheap'
  if (!first || first.type !== 'concept') return

  useSession.setState({ replaying: true, turns: [], draft: '' })
  useMise.setState({ concept: null, versions: [], prediction: null })

  // The owner types the idea.
  await sleep(700)
  for (let i = 1; i <= idea.length; i++) {
    useSession.setState({ draft: idea.slice(0, i) })
    await sleep(28 + Math.random() * 30)
  }
  await sleep(350)
  const turnId = startTurn(idea)
  const ctx = { turnId, basePrediction: null as Prediction | null }
  const v1: Concept = {
    ...(edits?.type === 'edits' ? undo(first.concept, edits.edits) : first.concept),
    version: 1,
  }

  let photosDone: Promise<unknown> = Promise.resolve()
  for (const e of events) {
    switch (e.type) {
      case 'thinking':
        handleEvent(e, ctx)
        await sleep(1100)
        break
      case 'text':
        for (const chunk of e.delta.match(/\S+\s*/g) ?? []) {
          handleEvent({ type: 'text', delta: chunk }, ctx)
          await sleep(45)
        }
        await sleep(250)
        break
      case 'concept':
        if (e.concept.version !== 1) break
        handleEvent({ type: 'concept', concept: v1 }, ctx)
        await sleep(500)
        photosDone = photos(v1, ctx)
        break
      case 'simulating': {
        handleEvent({ type: 'simulating', scenario: useMise.getState().scenario }, ctx)
        const [p] = await Promise.all([simulate(v1), sleep(1200)])
        handleEvent({ type: 'prediction', prediction: p }, ctx)
        await sleep(900)
        break
      }
      case 'edits':
        await sleep(1200)
        handleEvent(e, ctx)
        break
      default:
        // generating, generated, the v3 concept and its prediction: photos and the city run live instead,
        // and the approval click produces the next version.
        break
    }
  }
  handleEvent({ type: 'done' }, ctx)
  useSession.setState({ replaying: false })
  void photosDone.then(() => finish(turnId))
}

/** Ask the local server for each photo. A cached photo comes back at once. A failure keeps the fallback card. */
function photos(concept: Concept, ctx: { turnId: string; basePrediction: Prediction | null }) {
  const targets = ['logo', ...concept.menu.map((m) => m.id)]
  for (const t of targets) handleEvent({ type: 'generating', target: t }, ctx)
  return Promise.allSettled(targets.map((t) => {
    const req = t === 'logo' ? api.generateLogo({ concept }).then((r) => r.logoUrl) : api.generateDish({ concept, itemId: t }).then((r) => r.imageUrl)
    return req
      .then((url) => url && handleEvent({ type: 'generated', target: t, url }, ctx))
      .catch(() => {})
  }))
}

async function simulate(concept: Concept): Promise<Prediction> {
  const scenario = useMise.getState().scenario
  try {
    return await api.simulate({ concept, scenario })
  } catch {
    return Prediction.parse({ ...fixturePrediction, conceptId: concept.id, conceptVersion: concept.version, scenario })
  }
}
