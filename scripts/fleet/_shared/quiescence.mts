/*
 * @file Repo quiescence signal — "is this repo safe for an external agent to
 *   land into right now?". Replaces ad-hoc bash watchers that polled only
 *   origin/main.
 *
 *   WHY origin/main stability alone is a FALSE all-clear: a co-session commits
 *   to its LOCAL main and edits uncommitted WIP *between* pushes, so a remote
 *   ref that looks settled says nothing about the primary tree a human or a
 *   sibling agent is actively editing. Real quiescence therefore folds in the
 *   PRIMARY TREE (trackedDirty — tracked-only, so a stray build artifact never
 *   masks it), a stable LOCAL HEAD (the co-session's own commits land here
 *   first), and a held .git/index.lock, a git operation in flight, and it must
 *   be SUSTAINED across several samples rather than caught in a single lucky gap.
 *
 *   Complements _shared/git-mutex.mts: the mutex SERIALIZES fleet landers so two
 *   of them never race .git/index.lock; this module answers the orthogonal
 *   question of whether ANY actor, fleet or not, agent or human, is mid-flight,
 *   so a cross-session land can hold off before it even reaches for the mutex.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
// oxlint-disable-next-line socket/prefer-async-spawn -- a handful of blocking git probes on one repo path; readQuiescenceSignal is a synchronous snapshot by contract and the awaitQuiescence poll loop is already sequential.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// Poll cadence + ceiling mirror the git-mutex constants so a lander waiting on
// quiescence and a lander waiting on the mutex share one temporal model.
export const QUIESCENCE_POLL_MS = 300
export const QUIESCENCE_TIMEOUT_MS = 90 * 1000
// Consecutive quiescent+stable samples required before the repo is declared
// settled — a single sample can catch a lucky gap between a co-session's edits.
const DEFAULT_NEED_STABLE = 3

export interface QuiescenceSignal {
  /**
   * `git rev-parse HEAD` of the local checkout, '' when unavailable. A moving
   * HEAD means a co-session is committing to local main between pushes.
   */
  head: string
  /**
   * The origin `refs/heads/main` sha from `ls-remote` (NO fetch, no local-ref
   * mutation), '' when unavailable. Stability here is necessary but never
   * sufficient — see the file header.
   */
  originMain: string
  /**
   * Count of TRACKED dirty entries from `git status --porcelain` (untracked
   * `??` lines excluded) — uncommitted WIP in the primary tree.
   */
  trackedDirty: number
  /**
   * True when `<git-dir>/index.lock` exists — a git operation is in flight.
   */
  indexLocked: boolean
}

export interface RunResult {
  status: number | undefined
  stdout: string
}

/**
 * Injectable command runner: cmd, args, cwd -> { status, stdout }. Tests pass
 * canned git output; production uses `defaultRun` (blocking spawnSync, like
 * git-mutex's rev-parse probe and cascade-and-land's defaultRun seam).
 */
export type RunFn = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => RunResult

export const defaultRun: RunFn = (cmd, args, cwd) => {
  const r = spawnSync(cmd, [...args], {
    cwd,
    stdioString: true,
    timeout: 15_000,
  })
  return {
    status: typeof r.status === 'number' ? r.status : undefined,
    stdout: typeof r.stdout === 'string' ? r.stdout : String(r.stdout ?? ''),
  }
}

/**
 * Snapshot the repo's quiescence signal via four read-only git probes. Never
 * fetches and never mutates a local ref. A probe that fails degrades to the
 * safe-looking value ('' / 0 / false) so a non-git path is reported quiescent
 * rather than crashing the caller — the decision functions judge the snapshot.
 */
export function readQuiescenceSignal(
  repoPath: string,
  run: RunFn = defaultRun,
): QuiescenceSignal {
  const headR = run('git', ['-C', repoPath, 'rev-parse', 'HEAD'], repoPath)
  const head = headR.status === 0 ? headR.stdout.trim() : ''

  // ls-remote is a read-only network peek: it never writes a local ref, so it
  // can't move HEAD or trip the diverged-branch probes elsewhere.
  const remoteR = run(
    'git',
    ['-C', repoPath, 'ls-remote', 'origin', 'refs/heads/main'],
    repoPath,
  )
  const originMain =
    remoteR.status === 0 ? (remoteR.stdout.trim().split(/\s+/)[0] ?? '') : ''

  const statusR = run(
    'git',
    ['-C', repoPath, 'status', '--porcelain'],
    repoPath,
  )
  const trackedDirty =
    statusR.status === 0 ? countTrackedDirty(statusR.stdout) : 0

  // Resolve the git-dir (correct for worktrees, whose .git is a file pointing
  // at the real dir) so the index.lock probe finds the right lock.
  const gitDirR = run(
    'git',
    ['-C', repoPath, 'rev-parse', '--git-dir'],
    repoPath,
  )
  const gitDirRaw = gitDirR.status === 0 ? gitDirR.stdout.trim() : ''
  const gitDir = gitDirRaw
    ? path.isAbsolute(gitDirRaw)
      ? gitDirRaw
      : path.resolve(repoPath, gitDirRaw)
    : path.join(repoPath, '.git')
  const indexLocked = existsSync(path.join(gitDir, 'index.lock'))

  return { head, originMain, trackedDirty, indexLocked }
}

// Count porcelain lines whose two status columns are NOT `??` (tracked-only).
// Untracked entries are noise a co-session's build step routinely produces, so
// they never mark the tree unsafe to land into.
function countTrackedDirty(porcelain: string): number {
  let count = 0
  const lines = porcelain.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trim() === '') {
      continue
    }
    if (line.slice(0, 2) !== '??') {
      count += 1
    }
  }
  return count
}

/**
 * PURE: the repo is quiescent when its tracked tree is clean and no git
 * operation holds the index lock. HEAD/origin movement is a STABILITY concern
 * (signalsStable), not a quiescence one.
 */
export function isRepoQuiescent(sig: QuiescenceSignal): boolean {
  return sig.trackedDirty === 0 && !sig.indexLocked
}

/**
 * PURE: two consecutive samples are stable when a prior sample exists and
 * neither HEAD nor origin/main moved between them. The `prev === undefined`
 * guard makes the very first sample never count as stable, so a sustained run
 * always spans at least two reads.
 */
export function signalsStable(
  prev: QuiescenceSignal | undefined,
  curr: QuiescenceSignal,
): boolean {
  return (
    prev !== undefined &&
    prev.head === curr.head &&
    prev.originMain === curr.originMain
  )
}

export interface AwaitQuiescenceOptions {
  intervalMs?: number | undefined
  timeoutMs?: number | undefined
  needStable?: number | undefined
  // How one sample is taken. Defaults to the real git-probing reader; tests
  // inject a synthetic reader so the settle/timeout arms never race real
  // subprocess latency against the wall-clock deadline under machine load.
  readSignal?: ((repoPath: string) => QuiescenceSignal) | undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Poll readQuiescenceSignal until the repo has been BOTH quiescent AND stable
 * vs the immediately prior sample, for `needStable` consecutive samples, then
 * return that settled signal. Returns undefined on timeout. The loop is thin by
 * design — every decision lives in the pure isRepoQuiescent / signalsStable
 * functions above.
 */
export async function awaitQuiescence(
  repoPath: string,
  options?: AwaitQuiescenceOptions | undefined,
): Promise<QuiescenceSignal | undefined> {
  const opts = { __proto__: null, ...options } as AwaitQuiescenceOptions
  const intervalMs = opts.intervalMs ?? QUIESCENCE_POLL_MS
  const timeoutMs = opts.timeoutMs ?? QUIESCENCE_TIMEOUT_MS
  const needStable = opts.needStable ?? DEFAULT_NEED_STABLE
  const readSignal = opts.readSignal ?? readQuiescenceSignal
  const deadline = Date.now() + timeoutMs
  let prev: QuiescenceSignal | undefined
  let streak = 0
  for (;;) {
    const curr = readSignal(repoPath)
    if (isRepoQuiescent(curr) && signalsStable(prev, curr)) {
      streak += 1
      if (streak >= needStable) {
        return curr
      }
    } else {
      streak = 0
    }
    prev = curr
    if (Date.now() >= deadline) {
      return undefined
    }
    await sleep(intervalMs)
  }
}
