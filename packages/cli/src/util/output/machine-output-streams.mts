/**
 * Stream policy for machine-output mode.
 *
 * Machine-output mode (--json, --markdown, --quiet) promises that stdout
 * carries ONLY the command payload. The logger already routes its status
 * helpers (info, warn, success, fail, skip) to stderr, and the spinner routes
 * its animation and status methods (including step / substep) to stderr. The
 * lib logger is the outlier: its `step` / `substep` helpers write to stdout,
 * so a command that reports progress with them contaminates the payload stream
 * under --json.
 *
 * `applyMachineOutputStreamPolicy` is called at the argv-parse boundary. When
 * machine-output mode is engaged it shadows the shared logger's `step` /
 * `substep` so they emit to stderr like every other status helper; when it is
 * not engaged it restores them. `logger.log` is left untouched — it is the
 * payload / primary-data channel (JSON, Markdown, and output-kind-gated human
 * text all flow through it) and must stay on stdout.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { LOG_SYMBOLS } from '@socketsecurity/lib-stable/logger/symbols'

import { isMachineOutputMode } from './mode.mts'

import type { MachineModeFlags } from './mode.mts'
import type { Logger } from '@socketsecurity/lib-stable/logger/logger'

export type StatusMethod = (msg: string, ...extras: unknown[]) => Logger

export interface SavedStatusMethods {
  step: StatusMethod | undefined
  substep: StatusMethod | undefined
}

let saved: SavedStatusMethods | undefined

/**
 * Route the logger's stdout-bound status helpers to stderr while machine-output
 * mode is engaged, and restore them otherwise. Called once per invocation at
 * the argv-parse boundary, alongside `setMachineOutputMode`.
 */
export function applyMachineOutputStreamPolicy(flags: MachineModeFlags): void {
  if (isMachineOutputMode(flags)) {
    engageMachineOutputStreams()
  } else {
    restoreMachineOutputStreams()
  }
}

/**
 * Shadow the shared logger's `step` / `substep` so they emit to stderr. Idem-
 * potent: a second call while already engaged is a no-op so the saved
 * originals are never overwritten with the shadows.
 */
export function engageMachineOutputStreams(): void {
  if (saved) {
    return
  }
  const logger = getDefaultLogger()
  saved = {
    step: logger.step?.bind(logger),
    substep: logger.substep?.bind(logger),
  }
  logger.step = function step(msg: string, ...extras: unknown[]): Logger {
    return logger.error(`${LOG_SYMBOLS['step']} ${msg}`, ...extras)
  }
  logger.substep = function substep(msg: string, ...extras: unknown[]): Logger {
    return logger.error(`  ${msg}`, ...extras)
  }
}

/**
 * Restore the logger's `step` / `substep` to the lib defaults. No-op when the
 * policy was never engaged.
 */
export function restoreMachineOutputStreams(): void {
  if (!saved) {
    return
  }
  const logger = getDefaultLogger()
  const { step, substep } = saved
  if (step) {
    logger.step = step
  }
  if (substep) {
    logger.substep = substep
  }
  saved = undefined
}
