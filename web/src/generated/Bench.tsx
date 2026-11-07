import { useMise } from '@/state/store'
import { MenuGrid } from './DishCard'
import { GenerationQueue } from './GenerationQueue'
import { Logo } from './Logo'

/** Lane B bench: the current concept's logo, menu grid and generation queue, outside the two panes. */
export function Bench() {
  const concept = useMise((s) => s.concept)
  if (!concept) return null
  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)_340px] gap-8 p-8">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex items-center gap-3">
          <Logo concept={concept} size={48} />
          <div className="min-w-0">
            <h2 className="text-[20px] leading-tight font-semibold text-ink">{concept.name}</h2>
            <p className="truncate text-ink-2">{concept.tagline}</p>
          </div>
        </div>
        <MenuGrid concept={concept} />
      </div>
      <div className="flex flex-col gap-5">
        <Logo concept={concept} size={160} />
        <GenerationQueue concept={concept} />
      </div>
    </div>
  )
}
