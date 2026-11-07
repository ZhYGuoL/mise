import { useEffect } from 'react'
import { LeftPane } from '@/left/LeftPane'
import { RightPane } from '@/right/RightPane'
import { useMise } from '@/state/store'

export default function App() {
  const concept = useMise((s) => s.concept)
  const simulate = useMise((s) => s.simulate)

  useEffect(() => {
    void simulate()
  }, [simulate])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
        <span className="font-semibold text-ink">Forkcast</span>
        {concept && (
          <>
            <span className="text-ink-3">/</span>
            <span className="text-ink">{concept.name}</span>
            <span className="rounded-chip bg-inset px-1.5 py-0.5 text-[12px] tabular-nums text-ink-2">
              v{concept.version}
            </span>
          </>
        )}
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="min-h-0 border-r border-line">
          <LeftPane />
        </section>
        <section className="min-h-0 bg-canvas">
          <RightPane />
        </section>
      </main>
    </div>
  )
}
