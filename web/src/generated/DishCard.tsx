import type { Concept, MenuItem } from '@mise/shared'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import LoadingState from '@/components/primitives/LoadingState'
import { photoFade, useCrossfade } from './motion'
import { RetryIcon } from './parts'
import { inputKey, useGenTask, useGeneration } from './store'

const tagLabel: Record<MenuItem['tags'][number], string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  halal: 'Halal',
  gluten_free: 'Gluten free',
  spicy: 'Spicy',
  late_night: 'Late night',
}

const categoryLabel: Record<MenuItem['category'], string> = {
  main: 'Main',
  side: 'Side',
  drink: 'Drink',
  dessert: 'Dessert',
  combo: 'Combo',
}

/** The photo stand-in: brand primary, dish name in the type system. Also the layer under every photo. */
function FallbackFace({ item, concept }: { item: MenuItem; concept: Concept }) {
  const { primary, background } = concept.brand.colors
  return (
    <div className="absolute inset-0 flex items-end p-3.5" style={{ background: primary, color: background }}>
      <span className="line-clamp-3 text-[17px] leading-[1.15] font-semibold tracking-[-0.01em] text-balance">
        {item.name}
      </span>
    </div>
  )
}

/**
 * A menu item with its generated photo. States: empty (fallback face), generating, done, failed.
 * It asks for its own photo on render, so any concept on screen fills in by itself.
 * `onSelect` makes the whole card clickable without nesting the regenerate button in another button.
 */
export function DishCard({
  item,
  concept,
  onSelect,
  selected = false,
}: {
  item: MenuItem
  concept: Concept
  onSelect?: () => void
  selected?: boolean
}) {
  const task = useGenTask(concept.id, item.id)
  const ensure = useGeneration((s) => s.ensure)
  const regenerate = useGeneration((s) => s.regenerate)
  const key = inputKey(concept, item.id)

  useEffect(() => {
    ensure(concept, item.id)
    // The key holds every prompt input, so the concept object itself is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, concept.id, item.id, ensure])

  const url = task?.url ?? item.imageUrl
  const photo = useCrossfade(url)
  const showsPhoto = !!photo.base
  const generating = task?.status === 'generating'
  const failed = !generating && (task?.status === 'failed' || photo.broken)

  return (
    <article
      className={`group relative overflow-hidden rounded-card border bg-surface ${
        selected ? 'border-ink' : 'border-line'
      }`}
    >
      <div className="@container relative aspect-[4/3] overflow-hidden">
        {!photo.base && <FallbackFace item={item} concept={concept} />}
        {photo.base && (
          <img src={photo.base} alt={item.name} draggable={false} className="absolute inset-0 size-full object-cover" />
        )}
        {photo.incoming && (
          <motion.img
            key={photo.incoming}
            src={photo.incoming}
            alt={photo.base ? '' : item.name}
            draggable={false}
            onLoad={() => photo.onLoad(photo.incoming!)}
            onError={() => photo.onError(photo.incoming!)}
            initial={{ opacity: 0 }}
            animate={{ opacity: photo.incomingLoaded ? 1 : 0 }}
            transition={photoFade}
            onAnimationComplete={() => photo.incomingLoaded && photo.onShown(photo.incoming!)}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {/* A new take is on its way: the current photo steps back under a flat veil. */}
        {generating && photo.base && <div className="absolute inset-0 bg-surface/55" />}

        {generating && (
          // On a narrow card the queue already shows the time, so the chip drops its timer.
          <div className="absolute top-2 left-2 z-10 flex h-7 items-center rounded-full border border-line bg-surface px-2.5 @max-[13rem]:[&_.font-mono]:hidden">
            <LoadingState label="Generating" />
          </div>
        )}

        {failed && (
          <button
            type="button"
            onClick={() => regenerate(concept, item.id)}
            aria-label={`Retry photo for ${item.name}`}
            className="absolute top-2 left-2 z-10 flex h-7 items-center gap-1.5 rounded-full bg-surface pr-2 pl-2.5
              text-[12px] font-medium text-red transition-colors duration-[80ms] hover:bg-red-tint"
          >
            Failed
            <RetryIcon />
          </button>
        )}

        {showsPhoto && !generating && !failed && (
          <button
            type="button"
            onClick={() => regenerate(concept, item.id)}
            aria-label={`Regenerate photo for ${item.name}`}
            title="Regenerate"
            className="absolute top-2 right-2 z-10 grid size-7 place-items-center rounded-full bg-surface text-ink-2
              opacity-0 transition-opacity duration-[80ms] group-hover:opacity-100 hover:text-ink
              focus-visible:opacity-100"
          >
            <RetryIcon size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          {/* The fallback face already shows the name, so it only repeats here under a photo. */}
          <h3 className={`line-clamp-2 min-w-0 font-medium ${showsPhoto ? 'text-ink' : 'text-ink-2'}`}>
            {onSelect ? (
              <button type="button" onClick={onSelect} className="text-left after:absolute after:inset-0">
                {showsPhoto ? item.name : categoryLabel[item.category]}
              </button>
            ) : showsPhoto ? (
              item.name
            ) : (
              categoryLabel[item.category]
            )}
          </h3>
          <span className="shrink-0 tabular-nums text-ink">${item.price.toFixed(2)}</span>
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <span key={t} className="rounded-chip bg-inset px-1.5 py-0.5 text-[12px] text-ink-2">
                {tagLabel[t]}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/** The menu as a grid of DishCards. Lane A can drop this in place of its own grid. */
export function MenuGrid({
  concept,
  selectedId,
  onSelect,
}: {
  concept: Concept
  selectedId?: string | null
  onSelect?: (itemId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {concept.menu.map((item) => (
        <DishCard
          key={item.id}
          item={item}
          concept={concept}
          selected={selectedId === item.id}
          onSelect={onSelect ? () => onSelect(item.id) : undefined}
        />
      ))}
    </div>
  )
}
