import { registerCommand } from '../commands'
import { runOptimize } from './run'

/** Wave 2: registers `/optimize` with the composer. Import once. */
registerCommand({ name: 'optimize', hint: 'orders 120 friday', run: runOptimize })

export { OptimizeRun } from './OptimizeRun'
