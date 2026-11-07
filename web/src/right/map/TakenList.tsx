import type { Prediction } from '@mise/shared'
import { int, shortName } from '../lib/format'

/**
 * Customers the concept takes from each restaurant, as a short list in the map's card. Used when the
 * labels would overlap at their restaurants. Pointing at a row marks that restaurant on the map.
 */
export function TakenList({
  stolen,
  onHighlight,
}: {
  stolen: Prediction['stolenFrom']
  onHighlight: (placeId: string | null) => void
}) {
  const rows = [...stolen].sort((a, b) => b.ordersLost - a.ordersLost)
  if (rows.length === 0) return null
  return (
    <div className="mt-3 flex items-baseline gap-x-4 border-t border-line px-0.5 pt-2.5">
      <span className="shrink-0 text-[12px] font-semibold text-ink">Customers taken</span>
      <ul className="flex min-w-0 flex-wrap gap-x-3.5 gap-y-1 text-[12px] leading-5">
        {rows.map((s) => (
          <li
            key={s.placeId}
            className="flex items-baseline gap-1.5 whitespace-nowrap"
            onPointerEnter={() => onHighlight(s.placeId)}
            onPointerLeave={() => onHighlight(null)}
          >
            <span className="font-medium text-red tabular-nums">-{int(s.ordersLost)}</span>
            <span className="text-ink-2">{shortName(s.name)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
