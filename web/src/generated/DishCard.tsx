import type { Concept, MenuItem } from '@mise/shared'

const tagLabel: Record<MenuItem['tags'][number], string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  halal: 'Halal',
  gluten_free: 'Gluten free',
  spicy: 'Spicy',
  late_night: 'Late night',
}

/** Stub. Lane B replaces this with photo, generating and failed states. Shows the photo or a flat brand-color card. */
export function DishCard({ item, concept }: { item: MenuItem; concept: Concept }) {
  const { colors } = concept.brand
  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.name} className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div
          className="flex aspect-[4/3] items-end p-3 text-[15px] leading-tight font-semibold"
          style={{ background: colors.primary, color: colors.background }}
        >
          {item.name}
        </div>
      )}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          {/* The fallback card already shows the name, so only a photo needs it repeated here. */}
          {item.imageUrl && <h3 className="truncate font-medium text-ink">{item.name}</h3>}
          <span className="tabular-nums text-ink">${item.price.toFixed(2)}</span>
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
