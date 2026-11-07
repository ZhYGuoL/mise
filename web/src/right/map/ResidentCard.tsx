import type { Concept, Resident, Restaurant } from '@mise/shared'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import { css, type RGB } from '../lib/color'
import type { Flow } from '../lib/flows'
import { DIET_LABEL, HOUSEHOLD_LABEL, SEGMENT_ONE, miles } from '../lib/format'
import { spring } from '../lib/motion'
import { clockLabel } from '../lib/time'

/** Personas often open with "Name, age." which the card already shows. */
const stripLead = (persona: string, name: string) =>
  persona.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*\\d+\\.\\s*`), '')

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="min-w-0 text-neutral-200">{children}</dd>
    </div>
  )
}

export function ResidentCard({
  resident,
  flow,
  concept,
  color,
  restaurants,
  onClose,
}: {
  resident: Resident
  flow: Flow | null
  concept: Concept
  color: RGB
  restaurants: Restaurant[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const distance = miles(resident.home, concept.location)
  const place = flow
    ? flow.concept
      ? concept.name
      : (restaurants.find((r) => r.placeId === flow.placeId)?.name ?? 'Another restaurant')
    : null

  return (
    <motion.div
      key={resident.id}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.moderate}
      className="absolute top-3 right-3 z-20 w-[272px] rounded-card p-3 text-[12.5px] leading-snug"
      style={{ background: 'rgb(24 24 26)', boxShadow: '0 0 0 1px rgb(255 255 255 / 0.1)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-white">
            {resident.name}, <span className="tabular-nums">{resident.age}</span>
          </div>
          <div className="text-neutral-400">
            {SEGMENT_ONE[resident.segment]} · {HOUSEHOLD_LABEL[resident.household]}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mt-0.5 -mr-0.5 grid size-6 place-items-center rounded-[6px] text-neutral-400 transition-colors duration-100 hover:bg-white/8 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <p className="mt-2 text-pretty text-neutral-300">{stripLead(resident.persona, resident.name)}</p>

      <dl className="mt-2.5 flex flex-col gap-1 border-t border-white/8 pt-2.5">
        <Row label="Ordered">
          {flow && place ? (
            <span className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: flow.concept ? css(color) : 'rgb(148 163 184)' }}
              />
              <span className="truncate">{place}</span>
              <span className="shrink-0 text-neutral-500 tabular-nums">{clockLabel(flow.t)}</span>
            </span>
          ) : (
            'No order'
          )}
        </Row>
        <Row label="Home">
          <span className="tabular-nums">{distance.toFixed(1)} mi</span> from {concept.name}
        </Row>
        <Row label="Budget">
          <span className="tabular-nums">${Math.round(resident.budgetPerMeal)}</span> per meal
        </Row>
        {resident.diet.length > 0 && (
          <Row label="Diet">{resident.diet.map((d) => DIET_LABEL[d]).join(', ')}</Row>
        )}
      </dl>
    </motion.div>
  )
}
