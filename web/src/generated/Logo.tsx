import type { Concept } from '@mise/shared'

/** Stub. Lane B replaces this with the generated mark. Shows the logo image, or a flat wordmark in brand colors. */
export function Logo({ concept, size = 40 }: { concept: Concept; size?: number }) {
  const { logoUrl, colors } = concept.brand
  if (logoUrl) {
    return <img src={logoUrl} alt={concept.name} width={size} height={size} className="rounded-chip object-contain" />
  }
  return (
    <div
      className="grid shrink-0 place-items-center rounded-chip font-semibold"
      style={{ width: size, height: size, background: colors.primary, color: colors.background, fontSize: size * 0.42 }}
      aria-label={concept.name}
    >
      {concept.name.slice(0, 1)}
    </div>
  )
}
