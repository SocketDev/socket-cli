/*
 * @file Repo-scoped fixer lock — a pidfile under node_modules/.cache/fleet/
 *   that serializes tree-mutating fixer runs (fix.mts, lint.mts --fix) so
 *   concurrent or zombie fixers can never race the same working tree (three
 *   orphaned fixers raced socket-lib for minutes, 2026-07). Semantics:
 *
 *   - Acquire is O_EXCL pidfile creation. On contention the caller gets the
 *     HOLDER's info (pid, script, since) to print, and must exit non-zero fast
 *     — never queue behind an interactive fixer.
 *   - Stale detection: a holder whose pid is no longer alive (crashed/killed
 *     fixer) is stolen — the stale file is removed and acquisition retried
 *     once. An unparseable lock file is treated as stale.
 *   - Reentrancy: fix.mts spawns `pnpm run lint --fix`, which would deadlock on
 *     its parent's lock. The holder exports FLEET_FIXER_LOCK_HELD=<pid> into
 *     its environment (lib spawn spreads process.env into children), and a
 *     child seeing that var skips acquisition — the parent already owns the
 *     tree. Pure-ish: the pid-liveness probe is an injectable seam so tests
 *     drive the stale/contended paths without real processes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

/**
 * Env var the lock holder exports so its spawned children (fix.mts →
 * `pnpm run lint --fix`) skip re-acquisition instead of deadlocking.
 */
export const FIXER_LOCK_ENV = 'FLEET_FIXER_LOCK_HELD'

export interface FixerLockInfo {
  pid: number
  script: string
  since: string
}

export type FixerLockResult =
  | { acquired: true; release: () => void }
  | { acquired: false; holder: FixerLockInfo }

/**
 * The lock file for a repo root. Lives in the gitignored fleet cache — never
 * the tracked tree.
 */
export function fixerLockPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    'node_modules',
    '.cache',
    'fleet',
    'fixer.lock.json',
  )
}

/**
 * Whether `pid` names a live process. `process.kill(pid, 0)` throws ESRCH for
 * a dead pid; EPERM means alive-but-not-ours, which still counts as alive.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string | undefined })?.code === 'EPERM'
  }
}

/**
 * Parse a lock file's contents. Undefined on any shape mismatch — an
 * unparseable lock is STALE (a crashed writer), never a blocker.
 * Pure — exported for tests.
 */
export function parseLockInfo(raw: string): FixerLockInfo | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const info = parsed as Partial<FixerLockInfo>
  if (
    typeof info.pid !== 'number' ||
    typeof info.script !== 'string' ||
    typeof info.since !== 'string'
  ) {
    return undefined
  }
  return { pid: info.pid, script: info.script, since: info.since }
}

/**
 * The contention message a blocked fixer prints before exiting non-zero:
 * names who holds the lock and how to recover. Pure — exported for tests.
 */
export function describeHolder(holder: FixerLockInfo): string {
  return (
    `another fixer holds the repo lock — pid ${holder.pid} ` +
    `(${holder.script}, since ${holder.since}). ` +
    `Exiting fast; re-run when it finishes (a dead holder is auto-stolen).`
  )
}

interface AcquireSeams {
  alive?: ((pid: number) => boolean) | undefined
  env?: NodeJS.ProcessEnv | undefined
  pid?: number | undefined
}

/**
 * Acquire the repo fixer lock (or report the live holder). Reentrant via
 * FLEET_FIXER_LOCK_HELD; stale holders are stolen. The returned `release`
 * removes the lock file and unsets the reentrancy env var — call it in a
 * `finally`. A process crash needs no cleanup: the dead pid is stolen by the
 * next acquirer.
 */
export function acquireFixerLock(
  lockFile: string,
  script: string,
  seams?: AcquireSeams | undefined,
): FixerLockResult {
  const s = { __proto__: null, ...seams } as AcquireSeams
  const alive = s.alive ?? isPidAlive
  const env = s.env ?? process.env
  const pid = s.pid ?? process.pid
  // Reentrant call: an ancestor fixer in this process tree already owns the
  // tree — do not re-acquire, do not release on exit (the owner does).
  if (env[FIXER_LOCK_ENV]) {
    return { acquired: true, release: () => {} }
  }
  mkdirSync(path.dirname(lockFile), { recursive: true })
  const payload = `${JSON.stringify({ pid, script, since: new Date().toISOString() })}\n`
  // Two attempts: the second runs only after a stale holder was swept.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockFile, payload, { flag: 'wx' })
      env[FIXER_LOCK_ENV] = String(pid)
      return {
        acquired: true,
        release: () => {
          delete env[FIXER_LOCK_ENV]
          safeDeleteSync(lockFile)
        },
      }
    } catch (e) {
      if ((e as { code?: string | undefined })?.code !== 'EEXIST') {
        throw e
      }
    }
    const holder = existsSync(lockFile)
      ? parseLockInfo(readFileSync(lockFile, 'utf8'))
      : undefined
    if (holder && alive(holder.pid) && holder.pid !== pid) {
      return { acquired: false, holder }
    }
    // Stale (dead pid, our own pid from a crashed prior run, or unparseable):
    // sweep and retry once.
    safeDeleteSync(lockFile)
  }
  // Both attempts hit EEXIST with a stale file reappearing — treat the repeat
  // writer as the holder even without readable info.
  return {
    acquired: false,
    holder: {
      pid: -1,
      script: 'unknown (lock file kept reappearing)',
      since: 'unknown',
    },
  }
}
