/*
 * @file Cross-session git coordination primitives. Multiple Claude sessions
 *   share one checkout and their Stop hooks can land work near-simultaneously;
 *   git serializes on `.git/index.lock`, so the loser of that race used to
 *   fail, and the fail-open landing contract swallowed it. Two remedies, both
 *   advisory and bounded:
 *
 *   - acquireGitMutex: a per-repo lock under `node_modules/.cache/fleet/` (atomic
 *     mkdir) so concurrent landers queue instead of colliding. Stale locks
 *     dead pid or past the stale window, are stolen, so a crashed session
 *     never wedges the repo.
 *   - retryGit: bounded backoff for the residual index.lock contention a mutex
 *     cannot cover, a human's editor, a non-fleet tool holding git.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
// oxlint-disable-next-line socket/prefer-async-spawn -- one blocking rev-parse on the mutex path; the caller is already sequential.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

export const GIT_MUTEX_STALE_MS = 3 * 60 * 1000
export const GIT_MUTEX_TIMEOUT_MS = 90 * 1000
const POLL_MS = 300

export interface GitMutexOptions {
  staleMs?: number | undefined
  timeoutMs?: number | undefined
}

export interface RetryGitOptions {
  attempts?: number | undefined
  baseDelayMs?: number | undefined
}

export interface GitRunLike {
  ok: boolean
  out: string
}

/**
 * Repo-ROOT for `dir`, its git toplevel, falling back to `dir` when git
 * cannot answer. Callers pass an arbitrary cwd — land-work passes the
 * session's — and anchoring the mutex on that raw path writes
 * `<cwd>/node_modules/` wherever the caller happened to stand. When that cwd
 * sits under a workspace-glob ancestor (e.g. `template/base/**`), the new
 * node_modules reads to pnpm as a manifest-less importer and EVERY
 * `pnpm run <script>` in the repo dies ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND.
 * Runtime state belongs at the repo root's node_modules/.cache/fleet/ —
 * exactly one store per checkout, per the runtime-state doctrine.
 */
export function resolveRepoRoot(dir: string): string {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir })
  const out = top.status === 0 ? String(top.stdout ?? '').trim() : ''
  return out === '' ? dir : out
}

function mutexDir(repoDir: string): string {
  return path.join(
    resolveRepoRoot(repoDir),
    'node_modules',
    '.cache',
    'fleet',
    'git-mutex',
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * True when a git failure's output is index/lock contention — another
 * process holds `.git/index.lock`, or a ref lock, right now. These are
 * the retryable failures; anything else is a real error.
 */
export function isGitIndexContention(out: string): boolean {
  return /index\.lock|Another git process|Unable to create .*\.lock/i.test(out)
}

/**
 * Acquire the per-repo landing mutex. Resolves to a release function, or
 * undefined when the lock could not be acquired inside `timeoutMs` — the
 * caller decides whether to skip, Stop-hook lander, or fail loud (manual
 * run). Atomic mkdir is the lock; a meta.json records holder pid + time
 * so a stale lock (dead pid, or older than `staleMs`) is stolen rather
 * than wedging every future landing.
 */
export async function acquireGitMutex(
  repoDir: string,
  options?: GitMutexOptions | undefined,
): Promise<(() => Promise<void>) | undefined> {
  const opts = { __proto__: null, ...options } as GitMutexOptions
  const staleMs = opts.staleMs ?? GIT_MUTEX_STALE_MS
  const timeoutMs = opts.timeoutMs ?? GIT_MUTEX_TIMEOUT_MS
  const lockDir = path.join(mutexDir(repoDir), 'land.lock')
  const metaPath = path.join(lockDir, 'meta.json')
  const deadline = Date.now() + timeoutMs
  await fs.mkdir(mutexDir(repoDir), { recursive: true })
  for (;;) {
    try {
      await fs.mkdir(lockDir, { recursive: false })
      await fs.writeFile(
        metaPath,
        JSON.stringify({ pid: process.pid, ts: Date.now() }),
      )
      return async () => {
        await safeDelete(lockDir)
      }
    } catch {
      let stale = false
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as {
          pid?: number | undefined
          ts?: number | undefined
        }
        const age = Date.now() - (meta.ts ?? 0)
        stale =
          age > staleMs || (typeof meta.pid === 'number' && !pidAlive(meta.pid))
      } catch {
        // Unreadable meta on an existing lock — age unknowable; steal only
        // after the stale window from NOW would loop forever, so treat an
        // unreadable meta as stale, the writer crashed mid-write.
        stale = true
      }
      if (stale) {
        await safeDelete(lockDir)
        continue
      }
      if (Date.now() >= deadline) {
        return undefined
      }
      await sleep(POLL_MS)
    }
  }
}

/**
 * Run a git operation with bounded backoff on index/lock contention.
 * Non-contention failures return immediately — only the transient
 * "another process holds the lock" shape retries.
 */
export async function retryGit<T extends GitRunLike>(
  fn: () => T,
  options?: RetryGitOptions | undefined,
): Promise<T> {
  const opts = { __proto__: null, ...options } as RetryGitOptions
  const attempts = opts.attempts ?? 5
  const baseDelayMs = opts.baseDelayMs ?? 300
  let last = fn()
  for (let i = 1; i < attempts; i += 1) {
    if (last.ok || !isGitIndexContention(last.out)) {
      return last
    }
    await sleep(baseDelayMs * i)
    last = fn()
  }
  return last
}
