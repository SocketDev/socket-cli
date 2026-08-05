#!/usr/bin/env node
/*
 * @file A GitHub Action ships THE REPO ITSELF at a git tag — the runner
 *   checks out the tag and executes the committed `dist/` bundle, not `src/`.
 *   So when `src/` moves after `dist/` was last rebuilt, tagging a release
 *   ships a bundle that silently does not contain the change.
 *
 *   This check is a CHEAP GIT PRE-FILTER for that failure. Git ancestry can
 *   PROVE STALENESS — a source change on a line the dist rebuild never saw —
 *   but it can never prove the committed bundle matches the source that
 *   produced it. Equal or ancestral SHAs are satisfied by a commit that
 *   touched `src/` and an unrelated `dist/` file, by a hand-edited `dist/`,
 *   and by a `dist/` rebuilt from a stale working tree. The authoritative
 *   proof of currency is a rebuild-and-diff in CI (install, build, then fail
 *   on a non-empty `git diff` of `dist/`); this check only rules staleness in
 *   or leaves it unproven.
 *
 *   DETECTION is git-only, no build tooling involved:
 *
 *   1. Resolve the last commit touching `dist/` (`git log -1 --format=%H --
 *      <distDir>`) and the last commit touching `src/` (same, `<srcDir>`).
 *   2. Either commit missing (the dir has no history — a repo with no such
 *      dir, or one this repo does not track) means NOT APPLICABLE: skip
 *      clean, no finding.
 *   3. Equal SHAs mean the same commit touched both, so ancestry proves no
 *      staleness — NO STALENESS PROVEN, not a claim that `dist/` is current.
 *   4. Otherwise ask `git merge-base --is-ancestor <srcCommit> <distCommit>`.
 *      Exit 0 means the source commit IS an ancestor of the dist commit — the
 *      dist rebuild came after (or alongside) that source change, so again NO
 *      STALENESS PROVEN. Exit 1 means it is not an ancestor — the source
 *      changed on a line the dist rebuild never saw, so dist is STALE. Any
 *      other exit (a git error, a killed spawn) answers nothing, so it is NOT
 *      APPLICABLE rather than a guessed verdict.
 *
 *   SCOPE. Only a repo whose cascade roster entry declares `publishes:
 *   ["github-action"]` ships this way at all — a repo that publishes to npm
 *   or crates.io has no `dist/` tag-execution model for this bug to affect.
 *   The roster read (`loadRosterFromRepo` + `resolveRepoName` +
 *   `publishesTo`) is the gate; an unreadable roster, an unresolvable repo
 *   name, or a repo outside the `github-action` channel all skip clean with a
 *   one-line reason — never a false negative reported as "no finding" with no
 *   explanation, and never a false positive on a repo this bug cannot touch.
 *
 *   MODE. Enforcing (`ENFORCING = true`): `action` is on the channel and this
 *   gate runs clean against it — its `dist/` and `src/` were last touched by
 *   the same commit (b313d09), so no staleness is provable there. Report-only
 *   mode existed only while no member declared the channel and the gate had
 *   never met a real target.
 *
 *   Exit codes: 0 — not applicable, clean, or a finding while ENFORCING is
 *   off; 1 — a finding while ENFORCING is on.
 *   Usage: node scripts/fleet/check/committed-dist-is-current.mts [--dist <dir>] [--src <dir>]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  loadRosterFromRepo,
  publishesTo,
  resolveRepoName,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Enforcing: `action` is on the channel and this runs clean against it (its
// dist/ and src/ were last touched by the same commit, b313d09).
const ENFORCING = true

export const DEFAULT_DIST_DIR = 'dist'
export const DEFAULT_SRC_DIR = 'src'

export type CommittedDistVerdict =
  | 'no-staleness-proven'
  | 'not-applicable'
  | 'stale'

/**
 * Inputs to the staleness decision: the last commit to touch each dir, plus
 * whether the source commit is an ancestor-or-equal of the dist commit.
 */
export interface CommittedDistStalenessInputs {
  readonly distCommit: string | undefined
  readonly isAncestorOrEqual: boolean | undefined
  readonly srcCommit: string | undefined
}

/**
 * The pure decision: given `inputs`, does git ancestry prove the committed
 * `dist/` is stale?
 *
 * `'no-staleness-proven'` is the strongest verdict ancestry supports — it says
 * the check found no proof of staleness, never that the bundle matches `src/`.
 * Only a rebuild-and-diff can say that.
 *
 * Equal SHAs are checked directly rather than folded into `isAncestorOrEqual`
 * so the caller can skip the `merge-base` spawn entirely when the two commits
 * already match. `undefined` for either commit means the dir has no git
 * history in this repo — not applicable, never a guessed finding.
 * `isAncestorOrEqual` is `undefined` when the `merge-base --is-ancestor` spawn
 * itself could not answer (a git error, a killed process) — again not
 * applicable rather than a guess.
 */
export function judgeCommittedDistStaleness(
  inputs: CommittedDistStalenessInputs,
): CommittedDistVerdict {
  const { distCommit, isAncestorOrEqual, srcCommit } = inputs
  if (!srcCommit || !distCommit) {
    return 'not-applicable'
  }
  if (srcCommit === distCommit) {
    return 'no-staleness-proven'
  }
  if (isAncestorOrEqual === undefined) {
    return 'not-applicable'
  }
  return isAncestorOrEqual ? 'no-staleness-proven' : 'stale'
}

/**
 * Read a `git merge-base --is-ancestor` exit status into the tri-state
 * `judgeCommittedDistStaleness` expects: `0` is a real "yes", `1` is a real
 * "no", and anything else (a non-zero git error, `undefined` from a killed
 * spawn) is "the question was never answered".
 */
export function isAncestorFromExitStatus(
  status: number | undefined,
): boolean | undefined {
  if (status === 0) {
    return true
  }
  if (status === 1) {
    return false
  }
  return undefined
}

export interface CommittedDistStaleFinding {
  readonly distCommit: string
  readonly distDir: string
  readonly srcCommit: string
  readonly srcDir: string
}

/**
 * The human-readable finding for a stale `dist/`, naming both commits so the
 * reader can `git log`/`git diff` the gap directly.
 */
export function formatCommittedDistStaleFinding(
  finding: CommittedDistStaleFinding,
): string {
  const { distCommit, distDir, srcCommit, srcDir } = finding
  return (
    `[committed-dist-is-current] ${srcDir}/ changed at ${srcCommit.slice(0, 12)} ` +
    `after ${distDir}/ was last rebuilt at ${distCommit.slice(0, 12)} — a tag ` +
    `cut right now ships the OLD ${distDir}/, silently missing the ${srcDir}/ change.\n` +
    `  What:   the committed ${distDir}/ bundle is what a tag consumer executes, ` +
    `not ${srcDir}/.\n` +
    `  Where:  ${srcDir}/ last touched at ${srcCommit}; ${distDir}/ last ` +
    `rebuilt at ${distCommit}.\n` +
    `  Saw:    ${srcCommit.slice(0, 12)} is not an ancestor of ${distCommit.slice(0, 12)}.\n` +
    `  Fix:    rebuild ${distDir}/ from ${srcDir}/ and commit it before tagging a release.`
  )
}

// The last commit to touch `dir` in this repo, or `undefined` when git has no
// history for it (missing dir, or a killed/errored spawn).
function lastCommitTouching(repoRoot: string, dir: string): string | undefined {
  const result = spawnSync('git', ['log', '-1', '--format=%H', '--', dir], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.status !== 0) {
    return undefined
  }
  const sha = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return sha || undefined
}

// Exit status of `git merge-base --is-ancestor <srcCommit> <distCommit>`, raw
// (0/1/other) so `isAncestorFromExitStatus` is the single place that turns it
// into the tri-state the decision function expects.
function mergeBaseIsAncestorStatus(
  repoRoot: string,
  srcCommit: string,
  distCommit: string,
): number | undefined {
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', srcCommit, distCommit],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], stdioString: true },
  )
  return typeof result.status === 'number' ? result.status : undefined
}

export function main(): void {
  const { values } = parseArgs({
    options: {
      dist: { default: DEFAULT_DIST_DIR, type: 'string' },
      src: { default: DEFAULT_SRC_DIR, type: 'string' },
    },
    strict: true,
  })
  const distDir =
    typeof values['dist'] === 'string' ? values['dist'] : DEFAULT_DIST_DIR
  const srcDir =
    typeof values['src'] === 'string' ? values['src'] : DEFAULT_SRC_DIR

  const roster = loadRosterFromRepo(REPO_ROOT)
  if (!roster) {
    logger.log(
      '[committed-dist-is-current] SKIPPED — no cascade roster resolved.',
    )
    return
  }
  const repoName = resolveRepoName(REPO_ROOT)
  if (!repoName) {
    logger.log(
      '[committed-dist-is-current] SKIPPED — could not resolve this repo’s roster name.',
    )
    return
  }
  if (!publishesTo(roster, repoName, 'github-action')) {
    logger.log(
      `[committed-dist-is-current] SKIPPED — ${repoName} does not publish to the github-action channel.`,
    )
    return
  }

  const srcCommit = lastCommitTouching(REPO_ROOT, srcDir)
  const distCommit = lastCommitTouching(REPO_ROOT, distDir)
  if (!srcCommit || !distCommit) {
    logger.log(
      `[committed-dist-is-current] SKIPPED — no git history for ${!srcCommit ? srcDir : distDir}/.`,
    )
    return
  }

  const isAncestorOrEqual =
    srcCommit === distCommit
      ? true
      : isAncestorFromExitStatus(
          mergeBaseIsAncestorStatus(REPO_ROOT, srcCommit, distCommit),
        )
  const verdict = judgeCommittedDistStaleness({
    distCommit,
    isAncestorOrEqual,
    srcCommit,
  })

  if (verdict === 'not-applicable') {
    logger.log(
      '[committed-dist-is-current] SKIPPED — `git merge-base --is-ancestor` could not answer.',
    )
    return
  }
  if (verdict === 'no-staleness-proven') {
    logger.log(
      `[committed-dist-is-current] no staleness detected — git ancestry puts the ` +
        `last ${srcDir}/ change at or before the last ${distDir}/ rebuild.\n` +
        `  Ancestry cannot prove the committed ${distDir}/ bundle matches ${srcDir}/; ` +
        `a CI rebuild-and-diff of ${distDir}/ is that proof.`,
    )
    return
  }

  const report = ENFORCING ? logger.fail : logger.warn
  report.call(
    logger,
    formatCommittedDistStaleFinding({
      distCommit,
      distDir,
      srcCommit,
      srcDir,
    }),
  )
  if (ENFORCING) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the committed dist/ bundle is not provably stale against src/',
  help: `Usage: node scripts/fleet/check/committed-dist-is-current.mts [flags]

  --dist <dir>  bundle directory to compare (default: dist)
  --src <dir>   source directory to compare (default: src)`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
