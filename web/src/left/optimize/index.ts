import { startTurn } from '../client'
import { registerCommand } from '../commands'
import { goalFromArgs, startOptimize } from './run'

/** Wave 2: registers `/optimize` with the composer. The chat agent starts the same run with its run_optimize tool. */
registerCommand({
  name: 'optimize',
  hint: 'orders 120 friday',
  run: (args) => startOptimize(startTurn(`/optimize${args ? ` ${args}` : ''}`), goalFromArgs(args)),
})

export { OptimizeRun } from './OptimizeRun'
