import type { Concept } from '@mise/shared'

/** Lane H: next to the name of an imported restaurant. "Existing", and where its menu came from. */

const chip = 'inline-flex h-5.5 shrink-0 items-center rounded-chip px-1.5 text-[12px] whitespace-nowrap'

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function ExistingTags({ concept }: { concept: Concept }) {
  const e = concept.existing
  if (!e) return null
  const site = e.menuSource === 'website' && e.websiteUrl ? host(e.websiteUrl) : null
  const rating = e.rating != null ? `${e.rating.toFixed(1)} from ${(e.reviews ?? 0).toLocaleString('en-US')} Google reviews` : undefined
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className={`${chip} bg-ink font-medium text-surface`} title={rating}>
        Existing
      </span>
      {site ? (
        <a
          href={e.websiteUrl!}
          target="_blank"
          rel="noreferrer"
          className={`${chip} bg-inset text-ink-2 shadow-hairline transition-colors duration-100 hover:text-ink`}
        >
          Menu from {site}
        </a>
      ) : (
        e.menuSource === 'estimated' && <span className={`${chip} bg-inset text-ink-2 shadow-hairline`}>Menu estimated</span>
      )}
    </span>
  )
}
