/*
 * @file Remember that a test run went red, so the failure cannot be walked away
 *   from.
 *
 *   The hole this closes, observed live: the pre-commit test gate runs the
 *   STAGED scope. A session that runs a broader suite, watches a test fail in a
 *   file it did not stage, and then commits its own files sails straight
 *   through - the gate never re-runs the failure, so nothing objects. The
 *   failure was seen, reported on screen, and left behind, which is exactly the
 *   "fix a failure in your reading window" rule going unenforced because no
 *   code was watching.
 *
 *   So the runner records what went red and the stop guard reads it back. A
 *   scope clears itself the moment the SAME scope passes, so the honest fix
 *   (re-run it green) is also the only thing that clears the ledger - there is
 *   no acknowledge-and-move-on path, deliberately.
 *
 *   Storage follows the runtime-state doctrine: a dep-0 store under
 *   `.cache/fleet/socket-failing-tests/`, never the tracked tree, shared by
 *   every session in the checkout so one session cannot hide another's red.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * One scope that went red, keyed by the vitest args so a later run of the same
 * scope can clear it.
 */
export interface FailingScope {
  /**
   * The vitest args, joined - the identity of the scope.
   */
  key: string
  /**
   * The human label the runner printed, for the stop guard's message.
   */
  label: string
}

/**
 * The ledger file for `projectDir`.
 */
export function failingTestsPath(projectDir: string): string {
  return path.join(
    projectDir,
    '.cache',
    'fleet',
    'socket-failing-tests',
    'failing.json',
  )
}

/**
 * The scope identity for a vitest invocation. Args only: the label is prose and
 * can differ between runs of the same scope.
 */
export function scopeKey(vitestArgs: readonly string[]): string {
  return vitestArgs.join(' ')
}

/**
 * Every scope currently recorded red. Empty when the file is absent or
 * unreadable - a corrupt ledger must not wedge every commit in the checkout.
 */
export function readFailingScopes(projectDir: string): FailingScope[] {
  const file = failingTestsPath(projectDir)
  if (!existsSync(file)) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? (parsed as FailingScope[]) : []
  } catch {
    return []
  }
}

function writeScopes(projectDir: string, scopes: FailingScope[]): void {
  const file = failingTestsPath(projectDir)
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(scopes, undefined, 2)}\n`, 'utf8')
  } catch {
    // A store we cannot write must never fail the test run it is observing.
  }
}

/**
 * Record `scope` as red, replacing any earlier entry for the same key.
 */
export function recordFailingScope(
  projectDir: string,
  scope: FailingScope,
): void {
  const kept = readFailingScopes(projectDir).filter(s => s.key !== scope.key)
  kept.push(scope)
  writeScopes(projectDir, kept)
}

/**
 * Drop `key` from the ledger, which is what a passing run of that scope means.
 */
export function clearFailingScope(projectDir: string, key: string): void {
  const before = readFailingScopes(projectDir)
  const kept = before.filter(s => s.key !== key)
  if (kept.length !== before.length) {
    writeScopes(projectDir, kept)
  }
}
