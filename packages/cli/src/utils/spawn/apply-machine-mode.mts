/**
 * Helper that layers the per-tool machine-mode forwarding table on top
 * of an existing spawn invocation. Safe to call unconditionally — when
 * ambient machine-output mode is off, returns the inputs unchanged.
 */

import { getMachineOutputMode } from '../output/ambient-mode.mts'
import { applyMachineMode as rawApply } from './machine-mode.mts'

import type {
  MachineModeInput,
  MachineModeOutput,
} from './machine-mode.mts'

/**
 * Apply machine-mode flag forwarding + env injection when ambient
 * mode is engaged. Otherwise pass through unchanged.
 */
export function applyMachineModeIfActive(
  input: MachineModeInput,
): MachineModeOutput {
  if (!getMachineOutputMode()) {
    return {
      args: [...input.args],
      env: { ...input.env },
    }
  }
  return rawApply(input)
}

/**
 * Heuristic for "what's the subcommand" from an argv array. The first
 * non-flag token is the subcommand (npm install, pnpm ls, yarn add,
 * etc.). Returns undefined if args starts with a flag or is empty.
 */
export function inferSubcommand(
  args: readonly string[],
): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      return arg
    }
  }
  return undefined
}
