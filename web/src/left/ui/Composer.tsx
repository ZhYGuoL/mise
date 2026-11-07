import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listCommands, matchCommand, suggestionsFor } from '../commands'
import { useSession } from '../session'

/** Beautiful UI chat composer, driven by the session draft so the replay can type into it. */
export function Composer({
  placeholder,
  onSend,
  autoFocus,
  menuBelow,
}: {
  placeholder: string
  onSend: (text: string) => void
  autoFocus?: boolean
  /** open the command and suggestion list below the field, for the centered empty state */
  menuBelow?: boolean
}) {
  const draft = useSession((s) => s.draft)
  const busy = useSession((s) => s.busy)
  const replaying = useSession((s) => s.replaying)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [active, setActive] = useState(0)
  /** the draft the owner pressed Escape on. The list stays closed until the draft changes. */
  const [dismissed, setDismissed] = useState<string | null>(null)

  const commands = draft.startsWith('/') && !draft.includes(' ')
    ? listCommands().filter((c) => c.name.startsWith(draft.slice(1)))
    : []
  const canSend = draft.trim().length > 0 && !busy && !replaying

  // Lane H: a command's own rows while its args are typed, e.g. restaurants under "/import noo".
  const rows =
    dismissed === draft
      ? []
      : commands.length
        ? commands.map((c) => ({
            key: c.name,
            label: `/${c.name}`,
            detail: c.hint,
            mono: true,
            pick: () => {
              useSession.setState({ draft: `/${c.name} ` })
              ref.current?.focus()
            },
          }))
        : suggestionsFor(draft).map((sg) => ({
            key: sg.key,
            label: sg.label,
            detail: sg.detail,
            mono: false,
            pick: () => {
              if (busy || replaying) return
              useSession.setState({ draft: '' })
              void sg.run()
            },
          }))
  const current = Math.min(active, rows.length - 1)

  useEffect(() => setActive(0), [draft])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const send = () => {
    if (!canSend) return
    const text = draft.trim()
    const cmd = matchCommand(text)
    useSession.setState({ draft: '' })
    if (cmd) void cmd.command.run(cmd.args)
    else onSend(text)
  }

  return (
    <div className="relative">
      {rows.length > 0 && (
        <div
          role="listbox"
          className={`absolute inset-x-0 z-20 flex flex-col rounded-card bg-surface p-1 shadow-hairline ${menuBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}
        >
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={r.pick}
              className={`flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] ${i === current ? 'bg-hover' : ''}`}
            >
              <span className={`shrink-0 text-ink ${r.mono ? 'font-mono' : ''}`}>{r.label}</span>
              {r.detail && <span className="min-w-0 truncate text-ink-3">{r.detail}</span>}
            </button>
          ))}
        </div>
      )}
      <div
        role="presentation"
        onClick={() => ref.current?.focus()}
        className="flex cursor-text items-end gap-2 rounded-control border border-line bg-field p-2.5 transition-[border-color] duration-150 focus-within:border-line-strong"
      >
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          readOnly={replaying}
          onChange={(e) => useSession.setState({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (rows.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setActive((current + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length)
              return
            }
            if (rows.length && e.key === 'Escape') {
              e.preventDefault()
              setDismissed(draft)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (rows[current]) {
                rows[current].pick()
                return
              }
              send()
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-[120px] min-h-7 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          aria-label="Send"
          disabled={!canSend}
          onClick={send}
          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.96]"
          style={{
            background: canSend ? 'var(--ink)' : 'var(--line-strong)',
            color: canSend ? 'var(--surface)' : 'var(--ink-2)',
          }}
        >
          {busy ? (
            <span
              className="size-3 rounded-full border-[1.5px] border-ink-3 border-t-ink"
              style={{ animation: 'spin 700ms linear infinite' }}
            />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
