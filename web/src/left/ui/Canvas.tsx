import type { Concept, ConceptEdit, MenuItem } from '@mise/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/atoms/Button'
import { DishCard } from '@/generated/DishCard'
import { Logo } from '@/generated/Logo'
import { useMise } from '@/state/store'
import { manualEdit, viewVersion } from '../client'
import { cuisineLabel, diffConcepts, editLabel, formatValue, time12 } from '../format'
import { exit, spring } from '../motion'
import { useSession } from '../session'

const int = (n: number) => Math.round(n).toLocaleString('en-US')

/** Changed fields glow once in the accent tint after a new version lands. */
const flash = (on: boolean) => (on ? { animation: 'edit-flash 1600ms cubic-bezier(0.23,1,0.32,1) both' } : undefined)

function Meta({ concept, changed }: { concept: Concept; changed: string[] }) {
  const today = useMise((s) => s.scenario.day)
  const hours = concept.hours[today]
  const items: { key: string; text: string; hit: boolean }[] = [
    { key: 'cuisine', text: cuisineLabel(concept.cuisine), hit: changed.some((p) => p.startsWith('/cuisine')) },
    { key: 'tier', text: '$'.repeat(concept.priceTier), hit: changed.includes('/priceTier') },
    { key: 'where', text: concept.location.neighborhood, hit: changed.some((p) => p.startsWith('/location')) },
    {
      key: 'hours',
      text: hours ? `${today.slice(0, 3)} ${time12(hours.open)} to ${time12(hours.close)}` : `${today.slice(0, 3)} closed`,
      hit: changed.some((p) => p.startsWith(`/hours/${today}`)),
    },
    { key: 'fee', text: `${formatValue('/deliveryFee', concept.deliveryFee)} delivery`, hit: changed.includes('/deliveryFee') },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((m) => (
        <span
          key={m.key + m.text}
          className="inline-flex h-5.5 items-center rounded-chip bg-inset px-1.5 text-[12px] tabular-nums text-ink-2 shadow-hairline"
          style={flash(m.hit)}
        >
          {m.text}
        </span>
      ))}
    </div>
  )
}

function VersionRail({ onOpenDiff, diffOpen }: { onOpenDiff: () => void; diffOpen: boolean }) {
  const versions = useMise((s) => s.versions)
  const current = useMise((s) => s.concept?.version)
  if (versions.length === 0) return null
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {versions.map((v, i) => {
        const on = v.concept.version === current
        return (
          <div key={v.concept.version} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span className="h-px w-2.5 bg-line-strong" aria-hidden />}
            <button
              type="button"
              aria-pressed={on}
              onClick={() => (on ? onOpenDiff() : viewVersion(v.concept.version))}
              className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] tabular-nums transition-colors duration-100 ${
                on ? 'bg-ink text-surface' : 'bg-surface text-ink-2 shadow-hairline hover:bg-hover'
              }`}
            >
              <span className="font-mono font-medium">v{v.concept.version}</span>
              <span className={on ? 'text-surface/70' : 'text-ink-3'}>{v.prediction ? `${int(v.prediction.orders.p50)} orders` : '…'}</span>
            </button>
          </div>
        )
      })}
      {versions.length > 1 && (
        <button
          type="button"
          aria-expanded={diffOpen}
          onClick={onOpenDiff}
          className="ml-1.5 inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[12px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
        >
          {diffOpen ? 'Hide diff' : 'Diff'}
        </button>
      )}
    </div>
  )
}

/** Diff-table of a version against the one before it. */
function VersionDiff({ concept }: { concept: Concept }) {
  const versions = useMise((s) => s.versions)
  const i = versions.findIndex((v) => v.concept.version === concept.version)
  const prev = i > 0 ? versions[i - 1].concept : null
  const rows = useMemo(() => (prev ? diffConcepts(prev, concept) : []), [prev, concept])
  if (!prev) return <div className="rounded-card bg-surface px-3 py-2.5 text-[12.5px] text-ink-3 shadow-hairline">v{concept.version} is the first version</div>
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-hairline">
      <div className="primitive-card-bar flex items-center justify-between border-b border-line">
        <span className="text-[12.5px] font-medium text-ink">
          v{prev.version} → v{concept.version}
        </span>
        <span className="text-[11.5px] tabular-nums text-ink-3">{rows.length === 1 ? '1 change' : `${rows.length} changes`}</span>
      </div>
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[30%]" />
          <col className="w-[30%]" />
        </colgroup>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path} className="border-b border-line last:border-0">
              <td className="truncate px-3 py-2 text-[12.5px] font-medium text-ink">{editLabel(r, r.op === 'remove' ? prev : concept)}</td>
              <td className="truncate px-3 py-2 text-[12.5px] tabular-nums text-red line-through decoration-red/50" style={{ background: r.op === 'add' ? undefined : 'var(--red-tint)' }}>
                {r.op === 'add' ? '' : formatValue(r.path, r.previous)}
              </td>
              <td className="truncate px-3 py-2 text-[12.5px] tabular-nums text-green" style={{ background: r.op === 'remove' ? undefined : 'var(--green-tint)' }}>
                {r.op === 'remove' ? 'Removed' : formatValue(r.path, r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Hand edit of one dish. Saving makes ConceptEdits, same as the agent's. */
function DishEditor({ item, index, onClose }: { item: MenuItem; index: number; onClose: () => void }) {
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState(item.price.toFixed(2))
  const [description, setDescription] = useState(item.description)
  const priceN = Number(price)
  const valid = name.trim().length > 0 && Number.isFinite(priceN) && priceN >= 0

  const edits: ConceptEdit[] = []
  const reason = 'Edited by hand'
  if (name.trim() !== item.name) edits.push({ op: 'replace', path: `/menu/${index}/name`, value: name.trim(), previous: item.name, reason })
  if (valid && Math.round(priceN * 100) !== Math.round(item.price * 100))
    edits.push({ op: 'replace', path: `/menu/${index}/price`, value: Math.round(priceN * 100) / 100, previous: item.price, reason })
  if (description.trim() !== item.description)
    edits.push({ op: 'replace', path: `/menu/${index}/description`, value: description.trim(), previous: item.description, reason })

  const save = () => {
    if (!valid || edits.length === 0) return
    void manualEdit(edits)
    onClose()
  }

  const field = 'w-full rounded-control border border-line bg-field px-2.5 py-1.5 text-[13px] text-ink outline-none transition-[border-color] duration-150 focus:border-line-strong'
  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 bg-ink/15"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: spring.fast }}
      exit={{ opacity: 0, transition: exit.fast }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* centered over the left pane (5 of 12 columns) */}
      <div className="pointer-events-none flex w-5/12 justify-center px-5 pt-24">
      <motion.form
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: spring.slow }}
        exit={{ opacity: 0, y: 4, transition: exit.slow }}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="pointer-events-auto w-full max-w-[360px] overflow-hidden rounded-card bg-surface shadow-overlay"
      >
        <div className="primitive-card-bar border-b border-line text-[12.5px] font-medium text-ink">{item.name}</div>
        <div className="flex flex-col gap-2.5 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink-2">Name</span>
            <input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink-2">Price</span>
            <input className={`${field} tabular-nums`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink-2">Description</span>
            <textarea rows={2} className={`${field} resize-none`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="primitive-card-footer flex items-center justify-end gap-1.5 border-t border-line">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!valid || edits.length === 0}>
            {edits.length > 1 ? `Save ${edits.length} edits` : 'Save'}
          </Button>
        </div>
      </motion.form>
      </div>
    </motion.div>,
    document.body,
  )
}

export function Canvas({ concept }: { concept: Concept }) {
  const changed = useSession((s) => s.changed)
  const generating = useSession((s) => s.generating)
  const head = useMise((s) => Math.max(...s.versions.map((v) => v.concept.version)))
  const [editing, setEditing] = useState<number | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const viewingOld = concept.version !== head
  const root = useRef<HTMLDivElement>(null)

  // An edit landed on a dish that is scrolled away: bring it into view so the change is seen.
  useEffect(() => {
    const id = changed.find((c) => !c.startsWith('/'))
    if (id) root.current?.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [changed])

  return (
    <>
      <div ref={root} className="flex flex-col gap-3 px-5 pb-4">
        <div className="sticky top-0 z-10 -mx-5 flex flex-col gap-3 border-b border-line bg-page px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="relative" style={flash(changed.includes('/name'))}>
            <Logo concept={concept} size={44} />
            {generating.includes('logo') && <GeneratingDot />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[20px] leading-tight font-semibold text-ink" style={flash(changed.includes('/name'))}>
              {concept.name}
            </h2>
            <p className="truncate text-[13px] text-ink-2" style={flash(changed.includes('/tagline'))}>
              {concept.tagline}
            </p>
          </div>
        </div>
        <Meta concept={concept} changed={changed} />
        <div className="flex items-center justify-between gap-3">
          <VersionRail diffOpen={diffOpen} onOpenDiff={() => setDiffOpen((o) => !o)} />
          {viewingOld && (
            <Button variant="secondary" size="xs" onClick={() => viewVersion(head)} className="shrink-0">
              Back to v{head}
            </Button>
          )}
        </div>
        </div>
        {diffOpen && <VersionDiff concept={concept} />}
        <div className="grid grid-cols-4 gap-2">
          {concept.menu.map((item, i) => (
            <div
              key={item.id}
              data-item={item.id}
              role="button"
              tabIndex={0}
              aria-label={`Edit ${item.name}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                setEditing(i)
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setEditing(i))}
              className="relative cursor-pointer rounded-card transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98]"
              style={flash(changed.includes(item.id))}
            >
              <DishCard item={item} concept={concept} />
              {generating.includes(item.id) && <GeneratingDot />}
            </div>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {editing !== null && concept.menu[editing] && (
          <DishEditor key={concept.menu[editing].id} item={concept.menu[editing]} index={editing} onClose={() => setEditing(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

/** A photo is on its way for this slot. */
function GeneratingDot() {
  return (
    <span className="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-surface shadow-hairline">
      <span className="size-2.5 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: 'spin 700ms linear infinite' }} />
    </span>
  )
}
