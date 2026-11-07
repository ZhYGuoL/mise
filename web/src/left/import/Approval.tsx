import type { Block } from '../session'
import { Button } from '@/components/atoms/Button'
import { approveImport, skipImport } from './run'

/** Lane H: the agent wants to load a real restaurant over the current concept. Same card as an edit approval. */

const ENTER = { animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }

export function ImportApproval({ b }: { b: Extract<Block, { kind: 'import' }> }) {
  const p = b.place
  const where = [p.street, p.neighborhood].filter(Boolean).join(', ')
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-hairline" style={ENTER}>
      <div className="primitive-card-bar flex items-center border-b border-line">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">Replace {b.replaces}?</span>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-ink">{p.name}</span>
          {where && <span className="truncate text-[12px] text-ink-2">{where}</span>}
        </div>
        {p.rating != null && (
          <span className="shrink-0 text-[12px] tabular-nums text-ink-2">
            {p.rating.toFixed(1)} · {(p.reviews ?? 0).toLocaleString('en-US')} reviews
          </span>
        )}
      </div>
      <div className="primitive-card-footer flex min-h-11 items-center justify-between border-t border-line">
        {b.status === 'imported' ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-green-tint py-1 pr-2.5 pl-1 text-[12.5px] font-medium text-green"
            style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
          >
            <span className="flex size-4.5 items-center justify-center rounded-full bg-green text-white">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            Imported
          </span>
        ) : b.status === 'skipped' ? (
          <span className="pl-1 text-[12.5px] text-ink-3">Skipped</span>
        ) : b.status === 'failed' ? (
          <span className="pl-1 text-[12.5px] text-red">Failed</span>
        ) : (
          <>
            <span className="pl-1 text-[11.5px] text-ink-3">Clears the thread and versions</span>
            <span className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" disabled={b.status !== 'pending'} onClick={() => skipImport(b.id)}>
                Skip
              </Button>
              <Button variant="primary" size="sm" disabled={b.status !== 'pending'} onClick={() => void approveImport(b.id)}>
                {b.status === 'importing' ? 'Importing' : 'Import'}
              </Button>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
