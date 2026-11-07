import type { Concept } from '@mise/shared'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import { photoFade, useCrossfade } from './motion'
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
  const mark = useCrossfade(task?.url ?? concept.brand.logoUrl)
  const generating = task?.status === 'generating'

  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden font-semibold"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.16)),
        background: mark.base ? colors.background : colors.primary,
        color: colors.background,
        fontSize: size * 0.42,
      }}
      role="img"
      aria-label={concept.name}
      aria-busy={generating}
    >
      {!mark.base && !generating && concept.name.slice(0, 1)}
      {mark.base && <img src={mark.base} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />}
      {mark.incoming && (
        <motion.img
          key={mark.incoming}
          src={mark.incoming}
          alt=""
          draggable={false}
          onLoad={() => mark.onLoad(mark.incoming!)}
          onError={() => mark.onError(mark.incoming!)}
          initial={{ opacity: 0 }}
          animate={{ opacity: mark.incomingLoaded ? 1 : 0 }}
          transition={photoFade}
          onAnimationComplete={() => mark.incomingLoaded && mark.onShown(mark.incoming!)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* A new take is on its way: the current mark steps back under a flat veil in the brand background. */}
      {generating && mark.base && <span className="absolute inset-0" style={{ background: colors.background, opacity: 0.6 }} />}
      {generating && (
        <span className="absolute inset-0 z-10 grid place-items-center">
          <PixelLoader tone={mark.base ? colors.primary : colors.background} />
        </span>
      )}
    </div>
  )
}
