#!/usr/bin/env node
/**
 * @file `check --all` gate: no `upstream/` reference submodule is git-TRACKED
 *   as a gitlink. Upstream references are `.gitmodules`-only — the `ref =
 *   <40hex>` field is the pinned commit of record, so a tracked gitlink (a
 *   `160000` index entry under `upstream/`) is a redundant second copy of that
 *   SHA and is forbidden (see docs/agents.md/fleet/upstream-references.md). The
 *   write-time twin is `no-upstream-gitlink-guard`; this belt re-asserts the
 *   invariant over the committed index — catching a gitlink hand-staged past
 *   the guard. Exit: 0 — no tracked upstream gitlink (or git is unavailable); 1
 *   — at least one `160000` entry under `upstream/`. Usage: node
 *   scripts/fleet/check/upstream-gitlinks-are-absent.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

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
  return out.sort()
}

async function main(): Promise<void> {
  let output = ''
  try {
    const result = (await spawn('git', ['ls-files', '--stage'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string }
    output = String(result?.stdout ?? '')
  } catch {
    // git unavailable — another gate's concern; this belt is vacuous, never a
    // false-green failure on a non-git tree.
    process.exitCode = 0
    return
  }
  const offenders = findTrackedUpstreamGitlinks(output)
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
    `upstream-gitlinks-are-absent: ${offenders.length} gitlink(s) tracked under upstream/:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    logger.fail(`  ${offenders[i]!}`)
  }
  logger.fail(
    '  What:  an upstream/ reference is tracked as a gitlink (a 160000 index entry).\n' +
      '  Where: the path(s) above.\n' +
      '  Wanted: upstream/ references are .gitmodules-only — the ref + sha256: IS the pin, no gitlink.\n' +
      '  Fix:   git update-index --force-remove <path> (drops the gitlink, keeps .gitmodules).',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`upstream-gitlinks-are-absent failed: ${String(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
