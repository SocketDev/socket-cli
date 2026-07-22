/**
 * @file Code-as-law: the fleet SIGNS every commit. GitHub branch rulesets
 *   reject an unsigned push, but that failure surfaces late (at push) and not
 *   at all for a local-only branch — and a spawned tool whose environment can't
 *   reach the signing key commits UNSIGNED silently (observed: a subagent's
 *   `commit.gpgsign` quietly no-op'd, leaving three `%G? = N` commits that
 *   would have been rejected on push). This check fails the gate when any
 *   commit AHEAD of the tracked base carries no signature (`%G? = N`) or a bad
 *   one (`B`), naming the offenders + the one-line re-sign remedy, so the
 *   problem is caught in `check`/CI, not at the remote. Scope = commits
 *   reachable from HEAD but not from the base (the unpushed / in-PR set), never
 *   the whole history — old pre-policy commits stay untouched. Base =
 *   `@{upstream}`, else the origin default branch, else skip. FAIL-OPEN when
 *   the base can't be resolved (shallow/detached CI, no origin) so an offline
 *   checkout never reddens — a missing base means "can't tell", not "unsigned".
 *   Usage: node scripts/fleet/check/commits-are-signed.mts.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface UnsignedCommit {
  sha: string
  status: string
  subject: string
}

/**
 * Parse `git log --format=%H %G? %s` output into the commits whose signature
 * status is UNSIGNED (`N`) or BAD (`B`). A signature that merely can't be
 * verified against a trusted key (`U`/`X`/`Y`/`R`/`E`) still COUNTS as signed —
 * the invariant is "a signature is present + structurally valid", not "the key
 * is in this machine's trust store". Pure: the git call is injected by
 * `runCheck` so this is unit-testable offline.
 */
export function findUnsignedCommits(gitLog: string): UnsignedCommit[] {
  const unsigned: UnsignedCommit[] = []
  const lines = gitLog.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const line = raw.trimEnd()
    if (line === '') {
      continue
    }
    // <40-hex sha> <one-char %G?> <subject…>
    const m = /^([0-9a-f]{7,40})\s+(\S)\s?(.*)$/.exec(line)
    if (!m) {
      continue
    }
    const status = m[2]!
    if (status === 'B' || status === 'N') {
      unsigned.push({ sha: m[1]!, status, subject: m[3] ?? '' })
    }
  }
  return unsigned
}

interface Runner {
  (args: readonly string[]): Promise<{ ok: boolean; stdout: string }>
}

function gitRunner(cwd: string): Runner {
  return async args => {
    try {
      const res = await spawn('git', args as string[], {
        cwd,
        stdioString: true,
      })
      return { ok: res.code === 0, stdout: String(res.stdout ?? '') }
    } catch {
      return { ok: false, stdout: '' }
    }
  }
}

/**
 * Resolve the base ref to diff against: the tracked upstream if set, else the
 * origin default branch (`origin/HEAD` → e.g. `origin/main`), else undefined
 * (caller fail-opens). Never HEAD's parent — the scope is the whole unpushed
 * set.
 */
async function resolveBase(git: Runner): Promise<string | undefined> {
  const upstream = await git([
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  if (upstream.ok && upstream.stdout.trim()) {
    return upstream.stdout.trim()
  }
  const originHead = await git([
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  if (originHead.ok && originHead.stdout.trim()) {
    return originHead.stdout.trim()
  }
  for (const candidate of ['origin/main', 'origin/master']) {
    const verified = await git(['rev-parse', '--verify', '--quiet', candidate])
    if (verified.ok && verified.stdout.trim()) {
      return candidate
    }
  }
  return undefined
}

export interface RunCheckOptions {
  git?: Runner | undefined
}

/**
 * Fail the gate if any commit in `base..HEAD` is unsigned/bad-signed. Returns
 * the intended exit code (0 = all signed / base unresolvable / no commits
 * ahead, 1 = one or more unsigned).
 */
export async function runCheck(
  repoRoot: string,
  options?: RunCheckOptions | undefined,
): Promise<number> {
  const opts = { __proto__: null, ...options } as RunCheckOptions
  const git = opts.git ?? gitRunner(repoRoot)
  const base = await resolveBase(git)
  if (!base) {
    // Can't determine the upstream base (shallow/detached CI, no origin) →
    // fail-open: a missing base is "can't tell", never a red.
    return 0
  }
  const log = await git([
    'log',
    '--no-merges',
    '--format=%H %G? %s',
    `${base}..HEAD`,
  ])
  if (!log.ok) {
    return 0
  }
  const unsigned = findUnsignedCommits(log.stdout)
  if (unsigned.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[commits-are-signed] Unsigned commit(s) ahead of the base — the fleet signs every commit.',
      '',
      `  Base: ${base}`,
      '  Unsigned / bad-signed:',
      ...unsigned.map(
        u => `    - ${u.sha.slice(0, 9)} [${u.status}] ${u.subject}`,
      ),
      '',
      '  A GitHub branch ruleset rejects an unsigned push; catch it here first.',
      '  Fix: re-sign the range (recreates + signs, non-interactive):',
      `    git rebase --force-rebase --gpg-sign ${base}`,
      '  Ensure `git config commit.gpgsign true` + a signing key are set so new',
      '  commits sign automatically (a spawned tool with no key access commits',
      '  unsigned SILENTLY — this check is the backstop).',
      '',
    ].join('\n'),
  )
  return 1
}

async function main(): Promise<void> {
  process.exitCode = await runCheck(REPO_ROOT)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
