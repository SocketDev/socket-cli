#!/usr/bin/env node
/**
 * @file `check --all` gate: no git-TRACKED file is also matched by the repo's
 *   own `.gitignore`. A path that git would ignore yet still tracks is a bug —
 *   it ships state that a fresh clone re-ignores (build output, vendored trees,
 *   caches, a stray submodule gitlink), and it means the ignore rule and the
 *   index disagree. The authoritative detector is `git ls-files -ci
 *   --exclude-standard`, which already honors `.gitignore` negations: anything
 *   it lists is net-ignored AND tracked. The escape hatch for a hand-authored
 *   file that legitimately lives under an ignored tree is a re-include (a `!`
 *   negation, conventionally OUTSIDE the fleet-canonical block) — that
 *   un-ignores the path so it is no longer reported here. Superset of
 *   `upstream-gitlinks-are-absent` (a tracked `upstream/` gitlink is one kind
 *   of tracked-ignored path); this belt catches every other kind too.
 *   `--fix` needs a disposition because the two remedies are opposites:
 *   `--fix --untrack` drops each offender from the index (`git update-index
 *   --force-remove`, via _shared/untrack-offenders.mts — works on gitlinks and
 *   diverged-content paths where `git rm --cached` balks; the working copy
 *   stays) and RE-RUNS the detection — the re-check, not the executor, decides
 *   the exit. The `--reinclude` disposition is deliberately NOT automated:
 *   writing the `!` negation is judgment-heavy — it must land OUTSIDE the
 *   fleet-canonical block (parsing a managed region and picking an insertion
 *   point), and git ignores a `!` re-include whenever a parent DIRECTORY is
 *   excluded, so a correct re-include often means restructuring parent rules
 *   (`!dir/` + `dir/*` + `!dir/file`) depending on WHICH rule ignores the path
 *   — a mechanical append is frequently a silent no-op. Passing `--fix
 *   --reinclude` (or bare `--fix`) explains the manual path and changes
 *   nothing. Exit: 0 — no tracked-ignored path, or git is unavailable; 1 — at
 *   least one (or residual after `--fix --untrack`). Usage: node
 *   scripts/fleet/check/ignored-files-are-untracked.mts
 *   [--fix [--untrack|--reinclude]] [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  executeUntrackActions,
  formatUntrackAction,
  planUntrackActions,
} from '../_shared/untrack-offenders.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import type { UntrackAction } from '../_shared/untrack-offenders.mts'

const logger = getDefaultLogger()

/**
 * The tracked-yet-ignored paths in `git ls-files -ci --exclude-standard`
 * output (one path per line, `-z` not used here so newline-split is fine for
 * the check surface; the git call below stays line-oriented). Pure — no IO —
 * so the invariant unit-tests without a filesystem.
 */
export function findTrackedIgnoredFiles(lsFilesOutput: string): string[] {
  const out: string[] = []
  const lines = lsFilesOutput.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line === '') {
      continue
    }
    out.push(normalizePath(line))
  }
  return out.toSorted()
}

/**
 * The `--fix --untrack` plan for tracked-ignored paths: `git update-index
 * --force-remove` per offender — unconditional (covers gitlinks and
 * diverged-content paths where `git rm --cached` refuses), keeps the working
 * copy. The `--reinclude` disposition has no plan by design (see @file). Pure
 * — offenders in, actions out — so the plan unit-tests without git.
 */
export function planFix(offenders: readonly string[]): UntrackAction[] {
  return planUntrackActions(offenders, 'force-remove')
}

/**
 * Run the detection: the tracked-ignored paths right now, or `undefined` when
 * git is unavailable (another gate's concern; this belt is vacuous there).
 */
async function detectOffenders(): Promise<string[] | undefined> {
  try {
    const result = (await spawn(
      'git',
      ['ls-files', '-ci', '--exclude-standard'],
      {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        stdioString: true,
      },
    )) as { stdout?: string | undefined }
    return findTrackedIgnoredFiles(String(result?.stdout ?? ''))
  } catch {
    return undefined
  }
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const untrack = process.argv.includes('--untrack')
  const reinclude = process.argv.includes('--reinclude')
  let offenders = await detectOffenders()
  if (offenders === undefined) {
    // git unavailable — another gate's concern; this belt is vacuous, never a
    // false-green failure on a non-git tree.
    process.exitCode = 0
    return
  }
  let fixed = false
  if (offenders.length > 0 && fix) {
    if (untrack && !reinclude) {
      const failures = executeUntrackActions(planFix(offenders), REPO_ROOT)
      for (let i = 0, { length } = failures; i < length; i += 1) {
        const f = failures[i]!
        logger.warn(
          `ignored-files-are-untracked: fix step failed: ${formatUntrackAction(f.action)} — ${f.detail}`,
        )
      }
      // Success is measured by the RE-CHECK, never by executor belief.
      offenders = (await detectOffenders()) ?? []
      fixed = true
    } else {
      // Bare `--fix`, `--reinclude`, or both dispositions at once: nothing is
      // mutated. Re-including is manual by design (see @file: negation
      // placement + ignored-parent-dir semantics need judgment).
      logger.warn(
        'ignored-files-are-untracked: --fix needs a disposition — nothing was changed.\n' +
          '  `--fix --untrack`: drop each offender from the index (working copy stays).\n' +
          '  Re-include (keep a hand-authored file tracked) is MANUAL: add a `!` negation\n' +
          '  to .gitignore OUTSIDE the fleet-canonical block; if a parent dir is ignored,\n' +
          '  restructure its rules (`!dir/` + `dir/*` + `!dir/file`) or the negation is a\n' +
          '  silent no-op.',
      )
    }
  }
  if (offenders.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log('ignored-files-are-untracked: no tracked path is gitignored.')
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `ignored-files-are-untracked: ${offenders.length} tracked path(s) are matched by .gitignore${fixed ? ' after --fix --untrack' : ''}:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    logger.fail(`  ${offenders[i]!}`)
  }
  logger.fail(
    '  What:  a file git would ignore is nonetheless tracked (index vs .gitignore disagree).\n' +
      '  Where: the path(s) above.\n' +
      '  Wanted: nothing .gitignore ignores is tracked.\n' +
      '  Fix:   re-run with `--fix --untrack` to drop generated/vendored/junk from the\n' +
      '         index (the working copy stays), then the detection re-runs to confirm;\n' +
      '         OR, for a hand-authored file that must stay tracked, manually re-include\n' +
      '         it with a `!` negation OUTSIDE the fleet-canonical block so git no\n' +
      '         longer ignores it (not automated — see --fix --reinclude output).',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies no git-tracked file is also matched by the repo .gitignore',
  help: `Usage: node scripts/fleet/check/ignored-files-are-untracked.mts [flags]

  --fix        apply a disposition (requires --untrack or --reinclude)
  --untrack    with --fix, drop each offender from the index
  --reinclude  with --fix, explain the manual ! re-include path
  --quiet      suppress the success message`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
