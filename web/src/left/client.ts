import { type AgentEvent, type ChatMessage, type Concept, type ConceptEdit, Prediction } from '@mise/shared'
import { api } from '@/api'
import { useMise } from '@/state/store'
import { diffConcepts, formatValue, pathLabel, touchedItems } from './format'
import { type Block, findBlock, type Turn, uid, updateBlock, updateTurn, useSession } from './session'

/**
 * Lane A client: sends chat and apply requests, and folds the AgentEvent stream into
 * the thread (session store) and the concept versions (shared store).
 */

const headVersion = () => Math.max(0, ...useMise.getState().versions.map((v) => v.concept.version))

/** The concept to send. When an old version is open, new work branches from it but takes the next version number. */
function baseConcept(): Concept | null {
  const c = useMise.getState().concept
  return c ? { ...c, version: headVersion() } : null
}

/** What the model remembers between turns: the words, plus one line per edit and what the owner did with it. */
function history(): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const t of useSession.getState().turns) {
    if (t.role === 'user') {
      out.push({ role: 'user', content: t.text })
      continue
    }
    if (t.byHand) {
      const edits = t.blocks.find((b) => b.kind === 'edits')
      if (edits?.kind === 'edits') out.push({ role: 'user', content: `(I edited by hand: ${describe(edits.edits, edits.base)})` })
      continue
    }
    const parts: string[] = []
    for (const b of t.blocks) {
      if (b.kind === 'text') parts.push(b.text)
      if (b.kind === 'edits') {
        const what = describe(b.edits, b.base)
        const status =
          b.status === 'applied' ? `applied as v${b.version}` : b.status === 'skipped' ? 'the owner said no' : 'waiting for the owner'
        parts.push(`(Edits: ${what}. ${status}.)`)
      }
    }
    if (parts.length) out.push({ role: 'assistant', content: parts.join('\n') })
  }
  return out
}

const describe = (edits: ConceptEdit[], base: Concept) =>
  edits.map((e) => `${pathLabel(e.path, base)} ${formatValue(e.path, e.previous)} to ${formatValue(e.path, e.value)}`).join('; ')

/* ───────────── concept + image patches ───────────── */

function patchImage(target: string, url: string) {
  const s = useMise.getState()
  const name = s.concept?.menu.find((m) => m.id === target)?.name
  const fix = (c: Concept): Concept =>
    target === 'logo'
      ? { ...c, brand: { ...c.brand, logoUrl: url } }
      : { ...c, menu: c.menu.map((m) => (m.id === target && m.name === name ? { ...m, imageUrl: url } : m)) }
  useMise.setState({
    concept: s.concept && fix(s.concept),
    versions: s.versions.map((v) => ({ ...v, concept: fix(v.concept) })),
  })
}

let changedTimer: ReturnType<typeof setTimeout> | undefined
function flashChanged(ids: string[]) {
  useSession.setState({ changed: ids })
  clearTimeout(changedTimer)
  changedTimer = setTimeout(() => useSession.setState({ changed: [] }), 1800)
}

/** A new version keeps the photos the last version already has, even if they arrived after the server copied it. */
function carryImages(next: Concept): Concept {
  const prev = useMise.getState().concept
  if (!prev) return next
  return {
    ...next,
    brand: { ...next.brand, logoUrl: next.brand.logoUrl ?? (next.name === prev.name ? prev.brand.logoUrl : null) },
    menu: next.menu.map((m) => {
      const old = prev.menu.find((o) => o.id === m.id && o.name === m.name && o.imagePrompt === m.imagePrompt)
      return { ...m, imageUrl: m.imageUrl ?? old?.imageUrl ?? null }
    }),
  }
}

/* ───────────── event folding ───────────── */

type Ctx = { turnId: string; basePrediction: Prediction | null }

const last = (turnId: string): Block | undefined => {
  const t = useSession.getState().turns.find((x) => x.id === turnId)
  return t?.role === 'agent' ? t.blocks.at(-1) : undefined
}

const closeSteps = (blocks: Block[]) =>
  blocks.map((b) => (b.kind === 'steps' && b.endedAt === null ? { ...b, endedAt: Date.now() } : b))

export function handleEvent(e: AgentEvent, ctx: Ctx) {
  const { turnId } = ctx
  switch (e.type) {
    case 'thinking': {
      const b = last(turnId)
      if (b?.kind === 'steps' && b.endedAt === null) {
        updateBlock<'steps'>(turnId, b.id, (x) => ({ ...x, steps: [...x.steps, { label: e.label, detail: e.detail }] }))
      } else {
        updateTurn(turnId, (blocks) => [
          ...blocks,
          { kind: 'steps', id: uid('b'), steps: [{ label: e.label, detail: e.detail }], startedAt: Date.now(), endedAt: null },
        ])
      }
      return
    }
    case 'text': {
      const b = last(turnId)
      if (b?.kind === 'text') updateBlock<'text'>(turnId, b.id, (x) => ({ ...x, text: x.text + e.delta }))
      else updateTurn(turnId, (blocks) => [...closeSteps(blocks), { kind: 'text', id: uid('b'), text: e.delta.trimStart() }])
      return
    }
    case 'concept': {
      const mise = useMise.getState()
      const prev = mise.concept
      const concept = carryImages(e.concept)
      const isNew = !mise.versions.some((v) => v.concept.version === concept.version)
      mise.setConcept(concept)
      if (!isNew) return
      if (!prev || concept.version === 1) {
        updateTurn(turnId, (blocks) => [
          ...closeSteps(blocks),
          { kind: 'created', id: uid('b'), version: concept.version, name: concept.name },
        ])
        return
      }
      flashChanged(touchedItems(diffConcepts(prev, concept), concept).concat(diffConcepts(prev, concept).map((d) => d.path)))
      // The newest edits block without a version is the one this concept applies.
      const t = useSession.getState().turns.find((x) => x.id === turnId)
      const edits = t?.role === 'agent' ? [...t.blocks].reverse().find((b) => b.kind === 'edits' && b.version === null) : undefined
      if (edits) updateBlock<'edits'>(turnId, edits.id, (x) => ({ ...x, status: 'applied', version: concept.version }))
      return
    }
    case 'edits': {
      const base = useMise.getState().concept
      if (!base) return
      updateTurn(turnId, (blocks) => [
        ...closeSteps(blocks),
        {
          kind: 'edits',
          id: uid('b'),
          edits: e.edits,
          base,
          needsApproval: e.needsApproval,
          byHand: false,
          status: e.needsApproval ? 'pending' : 'applying',
          selected: e.edits.map(() => true),
          version: null,
        },
      ])
      return
    }
    case 'generating': {
      useSession.setState((s) => ({ generating: [...new Set([...s.generating, e.target])] }))
      const t = useSession.getState().turns.find((x) => x.id === turnId)
      const photos = t?.role === 'agent' ? t.blocks.find((b) => b.kind === 'photos' && !b.closed) : undefined
      if (photos) updateBlock<'photos'>(turnId, photos.id, (x) => ({ ...x, targets: { ...x.targets, [e.target]: 'running' } }))
      else
        updateTurn(turnId, (blocks) => [
          ...blocks,
          { kind: 'photos', id: uid('b'), targets: { [e.target]: 'running' }, closed: false },
        ])
      return
    }
    case 'generated': {
      patchImage(e.target, e.url)
      useSession.setState((s) => ({ generating: s.generating.filter((g) => g !== e.target) }))
      updateTurn(turnId, (blocks) =>
        blocks.map((b) =>
          b.kind === 'photos' && b.targets[e.target] ? { ...b, targets: { ...b.targets, [e.target]: 'done' } } : b,
        ),
      )
      return
    }
    case 'simulating': {
      const mise = useMise.getState()
      useMise.setState({ scenario: e.scenario, simulating: true })
      const version = mise.concept?.version ?? 0
      const bp = ctx.basePrediction
      const sameScenario =
        bp && bp.scenario.day === e.scenario.day && bp.scenario.weather === e.scenario.weather && bp.scenario.event === e.scenario.event
      const before = bp && sameScenario && bp.conceptVersion !== version ? bp.orders.p50 : null
      updateTurn(turnId, (blocks) => [
        ...closeSteps(blocks),
        { kind: 'sim', id: uid('b'), scenario: e.scenario, version, prediction: null, before },
      ])
      return
    }
    case 'prediction': {
      useMise.getState().setPrediction(e.prediction)
      useMise.setState({ simulating: false })
      const t = useSession.getState().turns.find((x) => x.id === turnId)
      const sim = t?.role === 'agent' ? [...t.blocks].reverse().find((b) => b.kind === 'sim' && !b.prediction) : undefined
      if (sim) updateBlock<'sim'>(turnId, sim.id, (x) => ({ ...x, prediction: e.prediction }))
      ctx.basePrediction ??= e.prediction
      return
    }
    case 'done': {
      updateTurn(turnId, closeSteps, { done: true })
      useSession.setState({ busy: false })
      return
    }
    case 'error': {
      useMise.setState({ simulating: false })
      updateTurn(turnId, (blocks) => [...closeSteps(blocks), { kind: 'error', id: uid('b'), message: e.message }])
      return
    }
  }
}

/** After the stream closes: photos that never came back stop spinning, and any unfinished state is closed. */
export function finish(turnId: string) {
  const t = useSession.getState().turns.find((x) => x.id === turnId)
  if (t?.role !== 'agent') return
  const pending = t.blocks.flatMap((b) => (b.kind === 'photos' ? Object.keys(b.targets).filter((k) => b.targets[k] === 'running') : []))
  useSession.setState((s) => ({ generating: s.generating.filter((g) => !pending.includes(g)) }))
  updateTurn(
    turnId,
    (blocks) =>
      closeSteps(blocks)
        .map((b) => (b.kind === 'photos' ? { ...b, closed: true } : b))
        .filter((b) => !(b.kind === 'photos' && !Object.values(b.targets).includes('done'))),
    { done: true },
  )
  if (!t.done) useSession.setState({ busy: false })
}

async function stream(body: Parameters<typeof api.agentChat>[0], turnId: string) {
  const ctx: Ctx = { turnId, basePrediction: body.prediction ?? null }
  try {
    await api.agentChat(body, (e) => handleEvent(e, ctx))
  } catch (err) {
    handleEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) }, ctx)
  } finally {
    finish(turnId)
  }
}

function currentPrediction(): Prediction | null {
  const { prediction, concept } = useMise.getState()
  return prediction && concept && prediction.conceptVersion === concept.version ? prediction : null
}

/* ───────────── public actions ───────────── */

export function startTurn(text: string): string {
  const turnId = uid('t')
  const turns: Turn[] = [
    { id: uid('t'), role: 'user', text },
    { id: turnId, role: 'agent', blocks: [], done: false },
  ]
  useSession.setState((s) => ({ turns: [...s.turns, ...turns], busy: true, draft: '' }))
  return turnId
}

export async function sendMessage(text: string) {
  const prior = history()
  const turnId = startTurn(text)
  const { scenario } = useMise.getState()
  await stream(
    { messages: [...prior, { role: 'user', content: text }], concept: baseConcept(), scenario, prediction: currentPrediction() },
    turnId,
  )
}

/** The owner said yes. Code applies the kept edits, then the city re-runs. */
export async function approve(blockId: string) {
  const found = findBlock(blockId)
  if (!found || found.block.kind !== 'edits' || found.block.status !== 'pending') return
  const { turnId, block } = found
  const edits = block.edits.filter((_, i) => block.selected[i])
  if (!edits.length) return skip(blockId)
  updateBlock<'edits'>(turnId, blockId, (x) => ({ ...x, status: 'applying' }))
  const { scenario } = useMise.getState()
  await stream({ messages: [], concept: baseConcept(), scenario, prediction: currentPrediction(), apply: edits }, turnId)
  const after = findBlock(blockId)
  if (after?.block.kind === 'edits' && after.block.status === 'applying')
    updateBlock<'edits'>(turnId, blockId, (x) => ({ ...x, status: 'failed' }))
}

export function skip(blockId: string) {
  const found = findBlock(blockId)
  if (found?.block.kind === 'edits') updateBlock<'edits'>(found.turnId, blockId, (x) => ({ ...x, status: 'skipped' }))
}

export function toggleEdit(blockId: string, index: number) {
  const found = findBlock(blockId)
  if (found?.block.kind === 'edits' && found.block.status === 'pending')
    updateBlock<'edits'>(found.turnId, blockId, (x) => ({ ...x, selected: x.selected.map((v, i) => (i === index ? !v : v)) }))
}

/** A hand edit from the canvas. Same path as an approval: code applies it and makes a version. */
export async function manualEdit(edits: ConceptEdit[]) {
  const base = useMise.getState().concept
  if (!base || !edits.length) return
  const turnId = uid('t')
  const block: Block = {
    kind: 'edits',
    id: uid('b'),
    edits,
    base,
    needsApproval: false,
    byHand: true,
    status: 'applying',
    selected: edits.map(() => true),
    version: null,
  }
  useSession.setState((s) => ({ turns: [...s.turns, { id: turnId, role: 'agent', blocks: [block], done: false, byHand: true }] }))
  const { scenario } = useMise.getState()
  await stream({ messages: [], concept: baseConcept(), scenario, prediction: currentPrediction(), apply: edits }, turnId)
  const after = findBlock(block.id)
  if (after?.block.kind === 'edits' && after.block.status === 'applying')
    updateBlock<'edits'>(turnId, block.id, (x) => ({ ...x, status: 'failed' }))
}

/** Open a version. Its prediction comes back with it, or the city runs it again. */
export function viewVersion(version: number) {
  const mise = useMise.getState()
  const v = mise.versions.find((x) => x.concept.version === version)
  if (!v) return
  useMise.setState({ concept: v.concept, prediction: v.prediction })
  if (!v.prediction) void mise.simulate()
}
