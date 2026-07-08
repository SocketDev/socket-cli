/**
 * @file Status display helpers for `fleet:status` — the read-only status verb.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here are pure display or throttle logic; none mutate the
 *   install state.
 *   Lock-step note: the sibling lockstep.mts module owns the lock-step state
 *   machine; this file only formats and renders it.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  formatLockStepError,
  formatUpdateNotice,
  readNoticeStore,
  shouldShowNotice,
  UPDATE_NOTIFIER_OPT_OUT_ENV,
  writeNoticeStore,
} from './lockstep.mts'
import type { LockStepState } from './lockstep.mts'

const logger = getDefaultLogger()

/**
 * Fire the passive update notice opportunistically (update-notifier style). The
 * caller already resolved a newer release exists; this throttles to once/24h
 * via the out-of-tree store, suppresses in CI, honors the opt-out env +
 * NO_COLOR, and NAMES the re-cascade. NEVER weakens the fetch-path verify or
 * the status hard-fail — it only silences the box. Returns true when a notice
 * was printed.
 */
export function maybeShowUpdateNotice(options: {
  readonly dest: string
  readonly updateAvailable: boolean
  readonly newestRef: string | undefined
}): boolean {
  const { dest, newestRef, updateAvailable } = {
    __proto__: null,
    ...options,
  } as typeof options
  const store = readNoticeStore(dest)
  const show = shouldShowNotice({
    ci: process.env['CI'] !== undefined && process.env['CI'] !== '',
    newestRef,
    nowMs: Date.now(),
    optedOut: process.env[UPDATE_NOTIFIER_OPT_OUT_ENV] === '1',
    store,
    updateAvailable,
  })
  if (!show || newestRef === undefined) {
    return false
  }
  const color = process.env['NO_COLOR'] === undefined
  process.stderr.write(`${formatUpdateNotice({ color, newestRef })}\n`)
  writeNoticeStore(dest, { lastCheckMs: Date.now(), lastSeenRef: newestRef })
  return true
}

export function printStatusReport(
  state: LockStepState,
  options: { noHeader: boolean },
): void {
  const opts = { __proto__: null, ...options } as typeof options
  const pinnedCell = `${state.config.ref} (${state.pinnedTemplateSha ?? '—'})`
  const landedCell = state.config.cascadeSha || '—'
  const newestCell =
    state.newestRef === undefined
      ? '—'
      : `${state.newestRef} (${state.newestTemplateSha ?? '—'})`
  if (state.state === 'current') {
    logger.log(`fleet:status: CURRENT — pinned ${pinnedCell}, in lock-step.`)
    return
  }
  if (!opts.noHeader) {
    logger.log('  Pinned                         | Landed       | Newest') // socket-lint: allow logger-decoration
  }
  const mismatchTag = state.state === 'out-of-sync' ? '  [MISMATCH]' : ''
  logger.log(`  ${pinnedCell} | ${landedCell} | ${newestCell}${mismatchTag}`) // socket-lint: allow logger-decoration
  if (state.state === 'update-available' && state.newestRef !== undefined) {
    logger.log(`re-cascade to ${state.newestRef}`)
    return
  }
  // OUT-OF-SYNC: print the parsed lock-step error + fail loud.
  logger.error(
    formatLockStepError({
      cascadeSha: state.config.cascadeSha,
      pinnedTemplateSha: state.pinnedTemplateSha,
      ref: state.config.ref,
    }),
  )
}

/**
 * Stable-keyed JSON shape for `fleet:status --json`. Keys never change between
 * states so a script can read them unconditionally.
 */
export function statusJson(state: LockStepState): Record<string, unknown> {
  return {
    cascadeSha: state.config.cascadeSha,
    inLockStep: state.inLockStep,
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- JSON sentinel: null serializes as `null`; undefined is dropped by JSON.stringify
    newestRef: state.newestRef ?? null,
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- JSON sentinel: null serializes as `null`; undefined is dropped by JSON.stringify
    newestTemplateSha: state.newestTemplateSha ?? null,
    pinnedRef: state.config.ref,
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- JSON sentinel: null serializes as `null`; undefined is dropped by JSON.stringify
    pinnedTemplateSha: state.pinnedTemplateSha ?? null,
    state: state.state,
    updateAvailable: state.updateAvailable,
  }
}
