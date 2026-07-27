// Commit / push-time staged-state gates: the oxlint rule-wiring check, the
// non-blocking staged-test reminder, the catastrophic mass-deletion guard, and
// the merge-in-progress / empty-index detectors. Gate-free; these run git +
// spawn against the current index.

import { existsSync } from 'node:fs'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { git, gitLines } from './git.mts'

// Staged-path prefixes/suffixes that mean an oxlint-plugin rule's WIRING could
// have changed: a rule file added/removed, the plugin index, or the oxlintrc
// activations. Both the dogfood root copies and the `template/` mirrors count.
const OXLINT_WIRING_PATH_RE =
  /(?:^|\/)(?:template\/)?\.config\/oxlint-plugin\/rules\/[^/]+\.mts$|(?:^|\/)(?:template\/)?\.config\/oxlint-plugin\/index\.mts$|(?:^|\/)(?:template\/)?\.config\/oxlintrc\.json$|(?:^|\/)(?:template\/)?\.config\/oxlint-plugin\/test\/[^/]+\.test\.mts$/

// Path (relative to repo root) of the rule-wiring generator. Present only in
// the wheelhouse — downstream fleet repos don't carry it, so the gate no-ops
// there (they have no plugin rule files to wire).
const SYNC_OXLINT_RULES_REL = 'scripts/fleet/sync-oxlint-rules.mts'

/**
 * Commit-time gate for oxlint plugin rule WIRING. When a commit stages any file
 * that can change rule wiring (a `rules/*.mts`, the plugin `index.mts`, the
 * `oxlintrc.json` activations, or a rule `test`), run the generator in
 * `--check` mode so a half-wired rule (file present but not imported /
 * activated / tested) can't land — even on a direct commit with no PR.
 *
 * Returns the generator's diagnostic text when wiring is out of sync, or
 * `undefined` when everything is in sync, no relevant file is staged, or the
 * generator isn't present (downstream repo). Deliberately fail-closed only on a
 * real drift signal: a generator that can't run (missing deps pre-install,
 * spawn error) returns undefined so a fresh checkout isn't blocked.
 *
 * @param stagedFiles POSIX-normalized staged paths (from `git diff --cached`).
 * @param repoRoot Absolute repo toplevel.
 */
export const checkOxlintRuleWiringStaged = (
  stagedFiles: readonly string[],
  repoRoot: string,
): string | undefined => {
  const touchesWiring = stagedFiles.some(f => OXLINT_WIRING_PATH_RE.test(f))
  if (!touchesWiring) {
    return undefined
  }
  const generatorPath = `${repoRoot}/${SYNC_OXLINT_RULES_REL}`
  if (!existsSync(generatorPath)) {
    return undefined
  }
  const r = spawnSync(process.execPath, [generatorPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  // Spawn failure (missing deps, node error) — fail open so a pre-install
  // checkout isn't blocked. Only a clean non-zero EXIT is a drift signal.
  if (r.error || typeof r.status !== 'number') {
    return undefined
  }
  if (r.status === 0) {
    return undefined
  }
  return (
    (r.stderr ?? '').trim() ||
    (r.stdout ?? '').trim() ||
    'sync-oxlint-rules --check reported drift.'
  )
}

// ── Staged-test reminder (WARN, never blocks) ──────────────────────
//
// `scripts/fleet/test.mts --staged` runs `vitest related` on the staged delta.
// Nothing invoked it at commit time, so a commit could break its own tests and
// the breakage only surfaced at pre-push / CI. This runs it as a NON-BLOCKING
// reminder: a failure prints a warning so the author sees it at the earliest
// moment, but the commit still lands. That's deliberate — the fleet cadence
// (CLAUDE.md "Smallest chunks, land ASAP") explicitly allows per-step
// `--no-verify` commits and gates tests at the MERGE (`fix --all` / `check
// --all` / `test` before landing). A blocking pre-commit test run would fight
// that workflow and slow every commit; the reminder surfaces breakage without
// changing the cadence. Returns a warning string on test failure, undefined on
// pass / no-related-tests / spawn error (fail-open).

const TEST_RUNNER_REL = 'scripts/fleet/test.mts'

// A staged file that could change test outcomes: a TS/JS source or test file.
// Lockfiles, markdown, JSON config, assets don't map to `vitest related`.
const TESTABLE_FILE_RE = /\.(?:c|m)?[jt]sx?$/

// Hard ceiling for the reminder's `vitest related` run. `vitest related`
// expands a staged delta to every test whose module graph reaches it; staging
// a universally-imported file (the vitest setup, a shared lib, the check
// runner) makes that ~the whole suite, which can run for many minutes and
// stall the commit (the reminder is non-blocking, but it still WAITS for the
// child). The timeout bounds it: past the ceiling the child is killed and the
// reminder skips with a note (fail-open), so a commit is never held hostage by
// a slow/over-broad related-run. CI / the merge gate still run the full suite.
const STAGED_TEST_TIMEOUT_MS = 60_000

export function runStagedTestsReminder(
  stagedFiles: readonly string[],
  repoRoot: string,
  // Overridable for tests; production uses the 60s ceiling.
  timeoutMs: number = STAGED_TEST_TIMEOUT_MS,
): string | undefined {
  const anyTestable = stagedFiles.some(f => TESTABLE_FILE_RE.test(f))
  if (!anyTestable) {
    return undefined
  }
  const runnerPath = `${repoRoot}/${TEST_RUNNER_REL}`
  if (!existsSync(runnerPath)) {
    return undefined
  }
  // Announce the bound BEFORE the spawn. The run is silent otherwise, so a
  // commit that is mid-run (especially a backgrounded one) is visually
  // indistinguishable from a true hang — which invites the wrong reaction
  // (`pkill -f vitest`, then concluding "it hung"). A visible deadline makes
  // the budget legible: this line + the skip note below mean an observer can
  // always tell "still within the 60s budget" from "stuck forever". Seconds,
  // not ms, so the number reads at a glance.
  const budgetSeconds = Math.round(timeoutMs / 1000)
  process.stderr.write(
    `[staged-tests] running related tests for the staged delta ` +
      `(<=${budgetSeconds}s budget, non-blocking)...\n`,
  )
  const r = spawnSync(process.execPath, [runnerPath, '--staged', '--quiet'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  })
  // Timed out → the related-set was too broad to run quickly. Skip with a note
  // (fail-open) rather than block; the merge gate runs the full suite anyway.
  // spawnSync sets `signal` (and `error.code === 'ETIMEDOUT'`) on a timeout.
  if (
    r.signal === 'SIGKILL' ||
    (r.error as { code?: string | undefined } | undefined)?.code === 'ETIMEDOUT'
  ) {
    // Emit the promised note: this is a fail-open SKIP at the budget, not a
    // failure and not a hang. The reaching-the-ceiling case is exactly when an
    // observer is most tempted to kill the process — say plainly that the
    // budget already did, so the commit proceeds.
    process.stderr.write(
      `[staged-tests] skipped after ${budgetSeconds}s budget — non-blocking; ` +
        `the merge gate runs the full suite.\n`,
    )
    return undefined
  }
  // Fail open: a spawn error (missing deps on a fresh checkout, node crash) is
  // not a test failure. Only a clean non-zero exit means staged tests failed.
  if (r.error || typeof r.status !== 'number' || r.status === 0) {
    return undefined
  }
  return (
    (r.stdout ?? '').trim() ||
    (r.stderr ?? '').trim() ||
    'vitest related reported failing tests for the staged delta.'
  )
}

// ── Catastrophic mass-deletion (pre-commit tier) ────────────────────
//
// The PreToolUse `mass-delete-guard` inspects the staged index when the `git
// commit` Bash command is FIRST seen — but a pre-commit step (lint/test) can
// stage deletions DURING the commit, after that check passed. A wedged
// `pnpm test` once left the entire `.claude/` tree staged-for-deletion mid
// commit, and the index snapshotted ~2400 deletions. This re-runs the same
// catastrophic-deletion check at pre-commit time — the index here IS the
// about-to-commit tree, post-churn — so no commit path can land a wipe.
//
// Correctly scoped for a surgical `git commit --only <paths>` / `-o <paths>`
// commit — VERIFIED, not assumed (see
// test/repo/integration/git-hooks/pre-commit.test.mts): git builds a
// TEMPORARY index containing only the named paths layered onto HEAD and
// points `GIT_INDEX_FILE` at it before invoking this hook. `gitLines` (and
// every other `git`/`gitOrThrow`/`spawnSync` call in this file) spawns with no
// `env` override, so it inherits `process.env` — including `GIT_INDEX_FILE` —
// unmodified. `git diff --cached` therefore reads foreign deletions staged
// elsewhere in the working index as OUT OF SCOPE; they never reach this
// count. Do not "fix" a reported over-block here without first reproducing it
// with a real `git commit --only` — the temp-index scoping is git's own
// mechanism, not something this hook implements or could break by itself.
//
// Thresholds kept in sync with .claude/hooks/fleet/mass-delete-guard/index.mts.
const DELETE_FLOOR = 50
const DELETE_RATIO = 0.75

// The catastrophic-deletion reason for the CURRENT staged index, or undefined
// when the staged deletions are within normal bounds. Pure of side effects
// beyond the git reads; the test drives `catastrophicDeletionFromCounts`.
export function catastrophicDeletionFromCounts(
  deletions: number,
  tracked: number,
): string | undefined {
  if (deletions >= DELETE_FLOOR) {
    return `${deletions} files staged for deletion (≥ ${DELETE_FLOOR})`
  }
  const denom = Math.max(tracked, 1)
  if (deletions / denom > DELETE_RATIO) {
    return `${deletions} of ${tracked} tracked files staged for deletion (> ${Math.round(
      DELETE_RATIO * 100,
    )}%)`
  }
  return undefined
}

export function catastrophicDeletionReason(): string | undefined {
  const deletions = gitLines(
    'diff',
    '--cached',
    '--diff-filter=D',
    '--name-only',
  ).length
  if (deletions === 0) {
    return undefined
  }
  const tracked = gitLines('ls-files').length
  return catastrophicDeletionFromCounts(deletions, tracked)
}

// Markers git writes under $GIT_DIR while a merge / cherry-pick / revert is
// mid-resolution. A commit recorded during one of these legitimately carries
// no staged delta of its own, so the empty-index gate must stand down.
const MERGE_STATE_MARKERS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']

/**
 * True when a merge, cherry-pick, or revert is in progress — detected by the
 * presence of git's in-progress marker files under `$GIT_DIR`. Resolves the git
 * dir via `git rev-parse --git-path <marker>` (handles worktrees, where the
 * marker lives in the per-worktree git dir, not the common dir). Best-effort:
 * if git can't be reached we report `false`, which means the empty-index gate
 * stays armed — failing toward the stricter check.
 */
export function mergeInProgress(): boolean {
  for (let i = 0, { length } = MERGE_STATE_MARKERS; i < length; i += 1) {
    const marker = MERGE_STATE_MARKERS[i]!
    const markerPath = git('rev-parse', '--git-path', marker)
    if (markerPath && existsSync(markerPath)) {
      return true
    }
  }
  return false
}

/**
 * True when the staged index carries no change of ANY kind relative to HEAD —
 * the about-to-be-recorded tree is identical to the parent, i.e. an empty
 * commit. Uses `git diff --cached --quiet`, whose exit code is the canonical
 * emptiness signal: 0 = no staged changes, 1 = some staged changes. This spans
 * every diff filter, so a pure-deletion commit correctly reports `false`.
 *
 * Best-effort: a non-0/1 status (git unreachable, no HEAD yet on a brand-new
 * repo) reports `false` so a legitimate first commit isn't blocked.
 */
export function stagedIndexIsEmpty(): boolean {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    encoding: 'utf8',
  })
  return result.status === 0
}
