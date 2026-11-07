import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listCommands, matchCommand } from '../commands'
import { useSession } from '../session'

/** Beautiful UI chat composer, driven by the session draft so the replay can type into it. */
export function Composer({
  placeholder,
  onSend,
  autoFocus,
}: {
  placeholder: string
  onSend: (text: string) => void
  autoFocus?: boolean
}) {
  const draft = useSession((s) => s.draft)
  const busy = useSession((s) => s.busy)
  const replaying = useSession((s) => s.replaying)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [active, setActive] = useState(0)

  const commands = draft.startsWith('/') && !draft.includes(' ')
    ? listCommands().filter((c) => c.name.startsWith(draft.slice(1)))
    : []
  const canSend = draft.trim().length > 0 && !busy && !replaying

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
      {commands.length > 0 && (
        <div className="absolute inset-x-0 bottom-full mb-1.5 flex flex-col rounded-card bg-surface p-1 shadow-hairline">
          {commands.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                useSession.setState({ draft: `/${c.name} ` })
                ref.current?.focus()
              }}
              className={`flex items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] ${i === active ? 'bg-hover' : ''}`}
            >
              <span className="font-mono text-ink">/{c.name}</span>
              <span className="text-ink-3">{c.hint}</span>
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
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (commands[active]) {
                useSession.setState({ draft: `/${commands[active].name} ` })
                return
              }
              send()
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-[120px] min-h-5 flex-1 resize-none bg-transparent text-[13px] leading-5 text-ink outline-none placeholder:text-ink-3"
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
