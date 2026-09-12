import { getInvocationMode } from './util/cli/invocation-mode.mts'
import { isMainModule } from '../scripts/fleet/process/is-main-module.mts'
import { runMain } from '../scripts/fleet/process/run-main.mts'

import type { ScriptMeta } from '../scripts/fleet/process/run-main.mts'

// Route to the appropriate CLI based on invocation mode.
export async function main(): Promise<void> {
  const mode = getInvocationMode()

  // Set environment variable for child processes.
  process.env['SOCKET_CLI_MODE'] = mode

  // Import and run the appropriate CLI function.
  // All wrapper modes now route through the main CLI entry with the mode set.
  // The CLI will detect the mode and run the appropriate command.
  await import('./cli-entry.mjs')
}

const SCRIPT_META: ScriptMeta = {
  describe: 'dispatch a Socket CLI wrapper invocation to its command mode',
  help: 'Usage: pnpm run dev [arguments]',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
