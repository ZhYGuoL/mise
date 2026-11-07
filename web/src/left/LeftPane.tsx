import { DishCard } from '@/generated/DishCard'
import { Logo } from '@/generated/Logo'
import { useMise } from '@/state/store'

/** Lane A owns this pane. Scaffold: the concept canvas from the store. */
export function LeftPane() {
  const concept = useMise((s) => s.concept)
  if (!concept) return null
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
      <div className="flex items-center gap-3">
        <Logo concept={concept} size={48} />
        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight font-semibold text-ink">{concept.name}</h2>
          <p className="truncate text-ink-2">{concept.tagline}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {concept.menu.map((item) => (
          <DishCard key={item.id} item={item} concept={concept} />
        ))}
      </div>
    </div>
  )
}
