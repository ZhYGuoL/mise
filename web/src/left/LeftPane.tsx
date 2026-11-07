import { useEffect, useRef } from 'react'
import { useMise } from '@/state/store'
import { sendMessage } from './client'
import { loadPlaces } from './import'
import { playReplay } from './replay'
import { useSession } from './session'
import { Canvas } from './ui/Canvas'
import { Composer } from './ui/Composer'
import { Thread } from './ui/Thread'
import './left.css'

const params = new URLSearchParams(window.location.search)

// The product starts empty: the owner's idea makes v1. `?seed=1` keeps the fixture concept for other lanes' work.
// This runs at import, before App's first simulate, so the seed never flashes.
if (!params.has('seed')) useMise.setState({ concept: null, versions: [], prediction: null })

const IDEAS = [
  'Late-night Korean fried chicken near CMU, cheap',
  'Vegan ramen counter in Shadyside',
  'Halal breakfast sandwiches in Oakland',
]

let replayStarted = false

/** Lane A: the ideation agent. Concept canvas on top, conversation below. */
export function LeftPane() {
  const concept = useMise((s) => s.concept)
  const turns = useSession((s) => s.turns)
  const start = useRef<HTMLDivElement>(null)

  /** Lane H: start from a real restaurant. Opens /import with the most reviewed places listed. */
  const startFromExisting = async () => {
    await loadPlaces()
    useSession.setState({ draft: '/import ' })
    start.current?.querySelector('textarea')?.focus()
  }

  useEffect(() => {
    if (params.get('replay') === '1' && !replayStarted) {
      replayStarted = true
      void playReplay()
    }
  }, [])

  if (!concept && turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 pb-16">
        <div ref={start} className="flex w-full max-w-[460px] flex-col gap-3">
          <h1 className="text-[20px] leading-tight font-semibold text-ink">What are you opening?</h1>
          <Composer placeholder="Describe the restaurant" onSend={(t) => void sendMessage(t)} autoFocus menuBelow />
          <div className="flex flex-col">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => void sendMessage(idea)}
                className="-mx-1.5 flex items-center gap-2 rounded-control px-1.5 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {idea}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void startFromExisting()}
              className="-mx-1.5 mt-1 flex items-center gap-2 rounded-control border-t border-line px-1.5 pt-2.5 pb-1.5 text-left text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M3 9l1.5-5h15L21 9" />
                <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
                <path d="M5 11.5V20h14v-8.5" />
              </svg>
              Existing restaurant
              <span className="ml-auto font-mono text-[11.5px] text-ink-3">/import</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {concept && (
        <div className="max-h-[55%] shrink-0 overflow-y-auto border-b border-line" style={{ animation: 'fade-up 380ms cubic-bezier(0.23,1,0.32,1) both' }}>
          <Canvas concept={concept} />
        </div>
      )}
      <Thread />
      <div className="shrink-0 px-5 pb-4">
        <Composer placeholder={concept ? 'Ask for a change' : 'Describe the restaurant'} onSend={(t) => void sendMessage(t)} />
      </div>
    </div>
  )
}
