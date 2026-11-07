import type { Concept } from '@mise/shared'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { photoFade } from './motion'
import { PixelLoader } from './parts'
import { inputKey, useGenTask, useGeneration } from './store'

/**
 * The generated mark, or a flat monogram in brand colors until it exists.
 * It asks for its own logo on render. While it generates, the loader takes the letter's place.
 */
export function Logo({ concept, size = 40 }: { concept: Concept; size?: number }) {
  const task = useGenTask(concept.id, 'logo')
  const ensure = useGeneration((s) => s.ensure)
  const key = inputKey(concept, 'logo')

  useEffect(() => {
    ensure(concept, 'logo')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, concept.id, ensure])

  const { colors } = concept.brand
  const url = task?.url ?? concept.brand.logoUrl
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const generating = task?.status === 'generating'
  const showsImage = !!url && brokenUrl !== url && loadedUrl === url

  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden font-semibold"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.16)),
        background: colors.primary,
        color: colors.background,
        fontSize: size * 0.42,
      }}
      role="img"
      aria-label={concept.name}
      aria-busy={generating}
    >
      {!generating && !showsImage && concept.name.slice(0, 1)}
      {url && brokenUrl !== url && (
        <motion.img
          key={url}
          src={url}
          alt=""
          draggable={false}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setBrokenUrl(url)}
          initial={{ opacity: 0 }}
          animate={{ opacity: loadedUrl === url ? (generating ? 0.5 : 1) : 0 }}
          transition={photoFade}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* Over a dimmed old mark (regenerate) the loader takes the mark's color, else the letter's. */}
      {generating && (
        <span className="absolute inset-0 z-10 grid place-items-center">
          <PixelLoader tone={showsImage ? colors.primary : colors.background} />
        </span>
      )}
    </div>
  )
}
