import type { Concept } from '@mise/shared'
import { useState } from 'react'
import { Button } from '@/components/atoms/Button'

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; ms: number } | { kind: 'error'; message: string }

/** Hands the restaurant to DoorDash: Aside fills DoorDash's real merchant sign-up in the browser. Never submits. */
export function DeployButton({ concept }: { concept: Concept }) {
  const [s, setS] = useState<State>({ kind: 'idle' })
  const go = async () => {
    setS({ kind: 'busy' })
    try {
      const r = await fetch('/api/deploy/doordash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept }),
      })
      const j = await r.json()
      setS(j.ok ? { kind: 'done', ms: j.ms } : { kind: 'error', message: 'Could not open DoorDash' })
    } catch {
      setS({ kind: 'error', message: 'Could not open DoorDash' })
    }
  }
  return (
    <span className="flex shrink-0 items-center gap-2">
      {s.kind === 'done' && <span className="text-[12px] text-ink-2">Filled on DoorDash in {(s.ms / 1000).toFixed(1)}s</span>}
      {s.kind === 'error' && <span className="text-[12px] text-red">{s.message}</span>}
      <Button variant="secondary" size="xs" onClick={go} disabled={s.kind === 'busy'} className="shrink-0">
        {s.kind === 'busy' ? 'Opening DoorDash…' : 'Deploy to DoorDash'}
      </Button>
    </span>
  )
}
