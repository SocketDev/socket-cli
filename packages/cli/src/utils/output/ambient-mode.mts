/**
 * Ambient machine-output mode context.
 *
 * meowOrExit / meowWithSubcommands set this once at argv-parse time so
 * spawn wrappers and output helpers can consult the current mode
 * without threading flags through every function signature.
 *
 * This is a single module-scoped let (not a Proxy, not AsyncLocalStorage)
 * — the CLI is a one-shot process with a single root invocation, so
 * module-scoped state is the simplest correct model. Tests that run
 * multiple invocations in sequence should call resetMachineOutputMode()
 * in their setup.
 */

import { isMachineOutputMode } from './mode.mts'

import type { MachineModeFlags } from './mode.mts'

let ambientMode = false

export function setMachineOutputMode(flags: MachineModeFlags): void {
  ambientMode = isMachineOutputMode(flags)
}

export function resetMachineOutputMode(): void {
  ambientMode = false
}

export function getMachineOutputMode(): boolean {
  return ambientMode
}
