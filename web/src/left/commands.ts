/**
 * Slash commands for the composer. Other lanes register here (Wave 2: `/optimize`, lane H: `/import`).
 * A registered command runs instead of a chat message when the draft starts with `/name`.
 */

/** Lane H: one autocomplete row under `/name <args>`. Picking it runs it. */
export type Suggestion = { key: string; label: string; detail?: string; run: () => void | Promise<void> }

export type Command = {
  name: string
  hint: string
  run: (args: string) => void | Promise<void>
  /** Lane H (optional): rows to offer while the owner types the args. Return [] to offer none. */
  suggest?: (args: string) => Suggestion[]
}

const registry = new Map<string, Command>()

export const registerCommand = (c: Command) => {
  registry.set(c.name, c)
}

export const listCommands = () => [...registry.values()]

/** "/optimize orders 120" -> the command and "orders 120", or null when no command matches. */
export function matchCommand(text: string): { command: Command; args: string } | null {
  const m = /^\/(\S+)\s*(.*)$/s.exec(text.trim())
  const command = m && registry.get(m[1])
  return command ? { command, args: m[2] } : null
}

/** Lane H: the rows for a draft like "/import noodle". Only once a space follows the command name. */
export function suggestionsFor(draft: string): Suggestion[] {
  const m = /^\/(\S+)\s(.*)$/s.exec(draft.trimStart())
  if (!m) return []
  return registry.get(m[1])?.suggest?.(m[2]) ?? []
}
