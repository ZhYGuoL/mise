import type { Concept, InterviewAnswer, Resident, Scenario } from '@mise/shared'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { api } from '@/api'
import { SEGMENT_ONE } from '../lib/format'
import './interview.css'

/**
 * Wave 2: interview the selected resident. The server recomputes their utility terms for this
 * concept and day, and the answer is written from those terms only. The terms show next to it.
 */

type Exchange = { id: number; question: string; answer: InterviewAnswer | null; error: string | null }

/** Exchanges per resident, concept version and scenario, so an old answer never shows for a new version. */
const useInterviews = create<{ log: Record<string, Exchange[]> }>()(() => ({ log: {} }))

const keyOf = (residentId: string, concept: Concept, s: Scenario) =>
  `${residentId}:${concept.id}:${concept.version}:${s.day}|${s.weather}|${s.event}`

let seq = 0

async function ask(key: string, residentId: string, concept: Concept, scenario: Scenario, question: string) {
  const id = ++seq
  const put = (fn: (x: Exchange) => Exchange) =>
    useInterviews.setState((s) => ({ log: { ...s.log, [key]: (s.log[key] ?? []).map((x) => (x.id === id ? fn(x) : x)) } }))
  useInterviews.setState((s) => ({ log: { ...s.log, [key]: [...(s.log[key] ?? []), { id, question, answer: null, error: null }] } }))
  try {
    const answer = await api.askResident(residentId, { concept, scenario, question })
    put((x) => ({ ...x, answer }))
  } catch (err) {
    put((x) => ({ ...x, error: err instanceof Error ? err.message : String(err) }))
  }
}

const QUESTIONS = ["Why didn't you order from us?", 'What would change your mind?']

const hourLabel = (h: number) => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`)

const Spinner = () => (
  <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: 'spin 700ms linear infinite' }} />
)

/** Diverging bar: right of center favors the concept, left favors what they picked instead. */
function TermBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = Math.min(1, Math.abs(value) / max) * 50
  return (
    <div className="relative h-1.5 w-full rounded-full bg-inset">
      <span className="absolute top-[-3px] bottom-[-3px] left-1/2 w-px bg-line-strong" />
      <span
        className="absolute top-0 bottom-0 rounded-full"
        style={{
          left: value >= 0 ? '50%' : `${50 - w}%`,
          width: `${w}%`,
          background: value >= 0 ? color : 'var(--ink-3)',
          transformOrigin: value >= 0 ? 'left center' : 'right center',
          animation: 'interview-grow 420ms cubic-bezier(0.23,1,0.32,1) both',
        }}
      />
    </div>
  )
}

function Terms({ a, concept, color }: { a: InterviewAnswer; concept: Concept; color: string }) {
  const terms = a.breakdown.filter((t) => t.factor !== 'total')
  const total = a.breakdown.find((t) => t.factor === 'total')
  const max = Math.max(0.5, ...terms.filter((t) => Math.abs(t.value) < 5).map((t) => Math.abs(t.value)))
  const other = a.against ?? a.choseInstead ?? 'No order'
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-hairline" style={{ animation: 'fade-up 400ms cubic-bezier(0.23,1,0.32,1) 100ms both' }}>
      <div className="primitive-card-bar flex items-center gap-2 border-b border-line">
        <span className="text-[13px] font-medium text-ink">Utility terms</span>
        <span className="inline-flex h-5 items-center rounded-md bg-inset px-1.5 text-[11.5px] font-medium text-ink-2 shadow-hairline tabular-nums">
          {terms.length}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[11.5px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-ink-3" />
            {other}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: color }} />
            {concept.name}
          </span>
        </span>
      </div>
      <div className="flex flex-col px-3 py-1.5">
        {terms.map((t) => {
          const deciding = t.factor === a.deciding
          return (
            <div key={t.factor} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,30%)_44px] items-center gap-3 py-1">
              <span className={`min-w-0 text-[12px] leading-snug text-pretty ${deciding ? 'font-medium text-ink' : 'text-ink-2'}`}>
                {t.factor.charAt(0).toUpperCase() + t.factor.slice(1)}
              </span>
              <TermBar value={t.value} max={max} color={color} />
              <span className={`text-right text-[12px] tabular-nums ${deciding ? 'font-medium text-ink' : 'text-ink-2'}`}>
                {t.value > 0 ? '+' : t.value < 0 ? '−' : ''}
                {Math.abs(t.value).toFixed(2)}
              </span>
            </div>
          )
        })}
        {total && (
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(120px,30%)_44px] items-center gap-3 border-t border-line pt-2 pb-1">
            <span className="text-[12px] font-medium text-ink">Total</span>
            <TermBar value={total.value} max={max} color={color} />
            <span className="text-right text-[12px] font-medium text-ink tabular-nums">
              {total.value > 0 ? '+' : total.value < 0 ? '−' : ''}
              {Math.abs(total.value).toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function Answer({ x, resident, concept, color }: { x: Exchange; resident: Resident; concept: Concept; color: string }) {
  const a = x.answer
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end pl-14" style={{ animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }}>
        <div className="rounded-xl bg-field px-3 py-1.5 text-[13px] leading-[1.45] text-ink">{x.question}</div>
      </div>
      {!a && !x.error && (
        <div className="flex h-7 items-center gap-2 text-[12.5px] text-ink-2">
          <Spinner />
          {resident.name}
        </div>
      )}
      {x.error && <div className="rounded-control bg-red-tint px-2.5 py-2 text-[12.5px] text-red">{x.error}</div>}
      {a && (
        <div className="flex flex-col gap-1" style={{ animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }}>
          <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <span className="font-medium text-ink-2">{resident.name}</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: a.wouldOrderFromConcept ? color : 'var(--ink-3)' }} />
              {a.wouldOrderFromConcept ? concept.name : (a.choseInstead ?? 'No order')}
            </span>
            {a.hour !== undefined && <span className="tabular-nums">{hourLabel(a.hour)}</span>}
          </div>
          <p className="text-[13px] leading-relaxed text-pretty text-ink">{a.answer}</p>
        </div>
      )}
    </div>
  )
}

export function Interview({
  resident,
  concept,
  scenario,
  color,
}: {
  resident: Resident
  concept: Concept
  scenario: Scenario
  color: string
}) {
  const key = keyOf(resident.id, concept, scenario)
  const log = useInterviews((s) => s.log[key]) ?? []
  const [draft, setDraft] = useState('')
  const busy = log.some((x) => !x.answer && !x.error)
  const latest = [...log].reverse().find((x) => x.answer)?.answer ?? null
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setDraft(''), [resident.id])

  const send = (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setDraft('')
    void ask(key, resident.id, concept, scenario, question)
  }

  return (
    <section
      aria-label={`Interview ${resident.name}`}
      className="flex flex-col gap-3 rounded-card bg-surface p-3 shadow-hairline"
      style={{ animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <div className="flex items-baseline gap-2 px-0.5">
        <span className="text-[13px] font-semibold text-ink">Ask {resident.name}</span>
        <span className="text-[12px] text-ink-3">
          {SEGMENT_ONE[resident.segment]}, <span className="tabular-nums">{resident.age}</span>
        </span>
      </div>

      {log.map((x) => (
        <Answer key={x.id} x={x} resident={resident} concept={concept} color={color} />
      ))}

      {latest && <Terms a={latest} concept={concept} color={color} />}

      <div className="flex flex-col gap-2">
        {log.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => send(q)}
                className="inline-flex h-7 items-center rounded-full bg-surface px-2.5 text-[12.5px] text-ink shadow-btn transition-[background-color,transform] duration-150 hover:bg-inset active:scale-[0.96] disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div
          role="presentation"
          onClick={() => ref.current?.focus()}
          className="flex cursor-text items-end gap-2 rounded-control border border-line bg-field p-2 transition-[border-color] duration-150 focus-within:border-line-strong"
        >
          <textarea
            ref={ref}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder={`Ask ${resident.name}`}
            aria-label={`Question for ${resident.name}`}
            className="max-h-[80px] min-h-5 flex-1 resize-none bg-transparent text-[13px] leading-5 text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            aria-label="Ask"
            disabled={!draft.trim() || busy}
            onClick={() => send(draft)}
            className="flex size-6 shrink-0 items-center justify-center rounded-[7px] transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.96]"
            style={{
              background: draft.trim() && !busy ? 'var(--ink)' : 'var(--line-strong)',
              color: draft.trim() && !busy ? 'var(--surface)' : 'var(--ink-2)',
            }}
          >
            {busy ? (
              <Spinner />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </section>
  )
}
