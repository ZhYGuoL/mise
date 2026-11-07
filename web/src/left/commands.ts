/**
 * Slash commands for the composer. Other lanes register here (Wave 2: `/optimize`).
 * A registered command runs instead of a chat message when the draft starts with `/name`.
 */
export type Command = { name: string; hint: string; run: (args: string) => void | Promise<void> }

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
