#!/usr/bin/env node
/**
 * @file `check --all` gate: no `upstream/` reference submodule is git-TRACKED
 *   as a gitlink. Upstream references are `.gitmodules`-only — the `ref =
 *   <40hex>` field is the pinned commit of record, so a tracked gitlink (a
 *   `160000` index entry under `upstream/`) is a redundant second copy of that
 *   SHA and is forbidden (see docs/agents.md/fleet/upstream-references.md). The
 *   write-time twin is `no-upstream-gitlink-guard`; this belt re-asserts the
 *   invariant over the committed index — catching a gitlink hand-staged past
 *   the guard. `--fix` drops each gitlink from the index (`git update-index
 *   --force-remove`, which keeps `.gitmodules`; a gitlink is exactly the entry
 *   `git rm --cached` mishandles — via _shared/untrack-offenders.mts) and
 *   RE-RUNS the detection — the re-check, not the executor, decides the exit.
 *   Exit: 0 — no tracked upstream gitlink, or git is unavailable; 1 — at least
 *   one `160000` entry under `upstream/` (or residual after `--fix`). Usage:
 *   node scripts/fleet/check/upstream-gitlinks-are-absent.mts [--fix] [--quiet]
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
 * The `upstream/` paths tracked as a gitlink in `git ls-files --stage` output.
 * Pure — no IO — so the invariant unit-tests without a filesystem. A gitlink
 * line is `160000 <sha> <stage>\t<path>`; only paths at or under `upstream/`
 * count.
 */
export function findTrackedUpstreamGitlinks(
  lsFilesStageOutput: string,
): string[] {
  const out: string[] = []
  const lines = lsFilesStageOutput.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.startsWith('160000 ')) {
      continue
    }
    const tab = line.indexOf('\t')
    if (tab === -1) {
      continue
    }
    const filePath = normalizePath(line.slice(tab + 1))
    if (filePath === 'upstream' || filePath.startsWith('upstream/')) {
      out.push(filePath)
    }
  }
  return out.toSorted()
}

/**
 * The `--fix` plan for tracked upstream gitlinks: `git update-index
 * --force-remove` per offender — the one remover that drops a `160000` entry
 * unconditionally while leaving `.gitmodules` untouched, and the `.gitmodules`
 * ref stays the pin of record. NOT `git rm --cached`, which balks on gitlink
 * entries. Pure — offenders in, actions out — so the plan unit-tests without
 * git.
 */
export function planFix(offenders: readonly string[]): UntrackAction[] {
  return planUntrackActions(offenders, 'force-remove')
}

/**
 * Run the detection: the tracked upstream gitlinks right now, or `undefined`
 * when git is unavailable (another gate's concern; this belt is vacuous there).
 */
async function detectOffenders(): Promise<string[] | undefined> {
  try {
    const result = (await spawn('git', ['ls-files', '--stage'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return findTrackedUpstreamGitlinks(String(result?.stdout ?? ''))
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  let offenders = await detectOffenders()
  if (offenders === undefined) {
    // git unavailable — another gate's concern; this belt is vacuous, never a
    // false-green failure on a non-git tree.
    process.exitCode = 0
    return
  }
  if (offenders.length > 0 && fix) {
    const failures = executeUntrackActions(planFix(offenders), REPO_ROOT)
    for (let i = 0, { length } = failures; i < length; i += 1) {
      const f = failures[i]!
      logger.warn(
        `upstream-gitlinks-are-absent: fix step failed: ${formatUntrackAction(f.action)} — ${f.detail}`,
      )
    }
    // Success is measured by the RE-CHECK, never by executor belief.
    offenders = (await detectOffenders()) ?? []
  }
  if (offenders.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log(
        'upstream-gitlinks-are-absent: no gitlink tracked under upstream/.',
      )
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `upstream-gitlinks-are-absent: ${offenders.length} gitlink(s) tracked under upstream/${fix ? ' after --fix' : ''}:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    logger.fail(`  ${offenders[i]!}`)
  }
  logger.fail(
    '  What:  an upstream/ reference is tracked as a gitlink (a 160000 index entry).\n' +
      '  Where: the path(s) above.\n' +
      '  Wanted: upstream/ references are .gitmodules-only — the ref + sha256: IS the pin, no gitlink.\n' +
      '  Fix:   re-run with `--fix` — each gitlink is dropped from the index\n' +
      '         (.gitmodules stays), then the detection re-runs to confirm.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no upstream/ reference submodule is git-tracked as a gitlink',
  help: `Usage: node scripts/fleet/check/upstream-gitlinks-are-absent.mts [flags]

  --fix    drop each tracked gitlink from the index and re-run the detection
  --quiet  suppress the clean-pass message`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
