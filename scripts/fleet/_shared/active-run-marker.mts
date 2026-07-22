/**
 * Active-run markers — a pidfile contract between long-running fleet
 * commands (coverage, full builds) and the stale-process-sweeper hook.
 *
 * The sweeper's "stuck" heuristic kills live-parent test workers that run
 * long at high CPU and RSS. A coverage-instrumented vitest worker looks
 * exactly like that while perfectly healthy (incident: three consecutive
 * `pnpm run cover` runs SIGKILLed at ~15 minutes with flat ~650MB RSS).
 * A command that registers an active-run marker declares "my worker tree
 * is doing real work"; the sweeper's stuck branch skips descendants of a
 * live registered pid. Orphan reaping is unaffected — a dead registrant's
 * marker is ignored (and cleaned by the next writer).
 *
 * CONTRACT (the sweeper hook implements its own tiny reader against the
 * same layout — keep in lockstep with
 * `.claude/hooks/fleet/stale-process-sweeper/index.mts`):
 * directory  ~/.claude/hooks/stale-process-sweeper/active-runs/
 * entry      one empty file per registrant, named `<pid>`
 * liveness   the file counts only while `kill -0 <pid>` succeeds.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

export function activeRunsDir(homeDir?: string | undefined): string {
  return path.join(
    homeDir ?? os.homedir(),
    '.claude',
    'hooks',
    'stale-process-sweeper',
    'active-runs',
  )
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export interface MarkerOptions {
  readonly homeDir?: string | undefined
  readonly pid?: number | undefined
}

// Register the calling process as an active run. Prunes markers whose
// registrant died without unregistering (a crash or SIGKILL).
export function registerActiveRun(options?: MarkerOptions | undefined): void {
  const opts = { __proto__: null, ...options }
  const dir = activeRunsDir(opts.homeDir)
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    if (!pidIsAlive(Number(entry))) {
      safeDeleteSync(path.join(dir, entry))
    }
  }
  writeFileSync(path.join(dir, String(opts.pid ?? process.pid)), '')
}

export function unregisterActiveRun(options?: MarkerOptions | undefined): void {
  const opts = { __proto__: null, ...options }
  const file = path.join(
    activeRunsDir(opts.homeDir),
    String(opts.pid ?? process.pid),
  )
  if (existsSync(file)) {
    safeDeleteSync(file)
  }
}

/**
 * True when another live process has a registered active run. A concurrent
 * vitest invocation during a coverage run cleans the shared coverage/.tmp
 * and ENOENTs the outer run's v8 reports (two live incidents on
 * 2026-07-11), so test runners consult this before starting. The caller's
 * own pid never counts.
 */
export function hasLiveForeignActiveRun(
  options?: MarkerOptions | undefined,
): boolean {
  const opts = { __proto__: null, ...options }
  const dir = activeRunsDir(opts.homeDir)
  if (!existsSync(dir)) {
    return false
  }
  const self = opts.pid ?? process.pid
  for (const entry of readdirSync(dir)) {
    const pid = Number(entry)
    if (pid !== self && pidIsAlive(pid)) {
      return true
    }
  }
  return false
}
