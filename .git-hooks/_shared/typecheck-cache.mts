// Pre-push typecheck memoization and serialization.
//
// The incident this exists for: 27 concurrent `git push` runs on one shared
// checkout each spawned an unserialized whole-project `tsc --noEmit`. Load
// reached 225, swap reached 14.9 GB of 17.4 GB, and free memory fell to 23%.
// Every tsc traced to a distinct pre-push parent, so these were 27
// independent pushes of the SAME tree, each recomputing the same verdict.
//
// Two mechanisms, in order:
//
//   1. A cache keyed on the tree's identity - HEAD plus the dirty-file set
//      the gate already reads. Twenty-seven pushes of one tree then cost one
//      typecheck, and the other twenty-six read the answer.
//
//   2. A WAITING lock around the cache miss. Fail-fast is wrong here: a peer
//      mid-typecheck would fail an unrelated push. Waiting means the second
//      pusher blocks briefly, then finds the verdict the first one just
//      wrote, which is the whole point of the cache.

import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * How long a cache-miss waits for a peer's typecheck before running its own.
 *
 * A whole-project typecheck on this repo takes well under two minutes, so a
 * wait this long covers a peer's full run. Past the deadline the waiter
 * proceeds rather than failing: a stuck holder must not block every push
 * behind it indefinitely.
 */
export const LOCK_WAIT_TIMEOUT_MS = 180_000

/**
 * How often the waiter re-checks the lock and the cache.
 *
 * Short enough that the second pusher leaves promptly once the first
 * finishes, long enough that waiting costs no measurable CPU.
 */
export const LOCK_POLL_INTERVAL_MS = 250

/**
 * A recorded typecheck outcome. `status` is tsc's exit code; `output` is its
 * combined stdout and stderr, replayed verbatim to a cache hit so the second
 * pusher sees the same diagnostics the first one did.
 */
export interface TypecheckVerdict {
  readonly output: string
  readonly status: number
}

/**
 * The identity of the tree a verdict describes.
 *
 * HEAD alone is not enough: the gate typechecks the WORKING TREE, so two
 * pushes at the same commit with different uncommitted edits are different
 * inputs. The dirty set is sorted so its order cannot change the key, and
 * each entry carries its size and mtime so an edit that keeps a path in the
 * set still moves the key.
 */
export function typecheckCacheKey(
  headSha: string,
  dirtyEntries: readonly string[],
): string {
  const hash = crypto.createHash('sha256')
  hash.update(headSha)
  hash.update('\0')
  const sorted = dirtyEntries.toSorted()
  for (let i = 0, { length } = sorted; i < length; i += 1) {
    hash.update(sorted[i]!)
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 32)
}

/**
 * A dirty path rendered as `<path>:<size>:<mtimeMs>`, so the key moves when
 * the bytes move.
 *
 * A path that has vanished between the listing and this read is recorded as
 * missing rather than throwing - it is still part of the tree's identity,
 * and a file that went away is a real difference.
 */
export function dirtyEntry(
  repoRoot: string,
  relativePath: string,
  statOf: (p: string) => { mtimeMs: number; size: number } | undefined,
): string {
  const stat = statOf(path.join(repoRoot, relativePath))
  if (!stat) {
    return `${relativePath}:missing`
  }
  return `${relativePath}:${stat.size}:${stat.mtimeMs}`
}

/**
 * Where a verdict for `key` is stored.
 *
 * Under the repo's own `.cache`, which is gitignored and safe to throw away:
 * the verdict is reproducible output for THIS checkout, not state that
 * should outlive it.
 */
export function verdictPath(cacheDir: string, key: string): string {
  return path.join(cacheDir, `${key}.json`)
}

/**
 * A previously recorded verdict for this tree, or undefined on a miss.
 *
 * An unreadable or half-written cache entry counts as a miss and never
 * throws. Memoization is an optimization; a bad entry must cost one
 * recomputation, not the push.
 */
export function readTypecheckVerdict(
  cacheDir: string,
  key: string,
): TypecheckVerdict | undefined {
  const file = verdictPath(cacheDir, key)
  if (!existsSync(file)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as TypecheckVerdict).status === 'number' &&
      typeof (parsed as TypecheckVerdict).output === 'string'
    ) {
      return parsed as TypecheckVerdict
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Record a verdict for this tree.
 *
 * A failed write is swallowed: a read-only or full cache directory must
 * degrade to "no memoization", never fail a push.
 */
export function writeTypecheckVerdict(
  cacheDir: string,
  key: string,
  verdict: TypecheckVerdict,
): void {
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(verdictPath(cacheDir, key), JSON.stringify(verdict))
  } catch {
    // Memoization is best-effort by design.
  }
}

/**
 * Why a waiter stopped waiting. `acquired` means this caller owns the lock
 * and must run the typecheck; `peer-finished` means a peer's verdict landed
 * in the cache while waiting; `timeout` means the holder outlived the
 * deadline and this caller proceeds unserialized rather than failing.
 */
export type LockWaitOutcome = 'acquired' | 'peer-finished' | 'timeout'

export interface LockWaitDeps {
  readonly cacheHit: () => boolean
  readonly now: () => number
  readonly sleep: (ms: number) => void
  readonly tryAcquire: () => boolean
}

/**
 * Wait for the typecheck lock, a peer's verdict, or the deadline.
 *
 * Free of I/O through its deps so a test drives every branch without a second
 * process. The cache is re-checked on every poll, which is what turns the
 * wait into a saving rather than a delay: the peer holding the lock is
 * computing the answer this caller wants.
 */
export function waitForTypecheckTurn(
  deps: LockWaitDeps,
  timeoutMs: number = LOCK_WAIT_TIMEOUT_MS,
  pollMs: number = LOCK_POLL_INTERVAL_MS,
): LockWaitOutcome {
  const deadline = deps.now() + timeoutMs
  for (;;) {
    if (deps.tryAcquire()) {
      return 'acquired'
    }
    if (deps.cacheHit()) {
      return 'peer-finished'
    }
    if (deps.now() >= deadline) {
      return 'timeout'
    }
    deps.sleep(pollMs)
  }
}
