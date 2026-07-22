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
 *   of tracked-ignored path); this belt catches every other kind too. Exit: 0 —
 *   no tracked-ignored path (or git is unavailable); 1 — at least one. Usage:
 *   node scripts/fleet/check/ignored-files-are-untracked.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

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
  return out.sort()
}

async function main(): Promise<void> {
  let output = ''
  try {
    const result = (await spawn(
      'git',
      ['ls-files', '-ci', '--exclude-standard'],
      {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        stdioString: true,
      },
    )) as { stdout?: string }
    output = String(result?.stdout ?? '')
  } catch {
    // git unavailable — another gate's concern; this belt is vacuous, never a
    // false-green failure on a non-git tree.
    process.exitCode = 0
    return
  }
  const offenders = findTrackedIgnoredFiles(output)
  if (offenders.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log('ignored-files-are-untracked: no tracked path is gitignored.')
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `ignored-files-are-untracked: ${offenders.length} tracked path(s) are matched by .gitignore:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    logger.fail(`  ${offenders[i]!}`)
  }
  logger.fail(
    '  What:  a file git would ignore is nonetheless tracked (index vs .gitignore disagree).\n' +
      '  Where: the path(s) above.\n' +
      '  Wanted: nothing .gitignore ignores is tracked.\n' +
      '  Fix:   untrack generated/vendored/junk with `git update-index --force-remove <path>`\n' +
      '         (or `git rm --cached`); OR, for a hand-authored file that must stay\n' +
      '         tracked, re-include it with a `!` negation OUTSIDE the fleet-canonical\n' +
      '         block so git no longer ignores it.',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`ignored-files-are-untracked failed: ${String(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
