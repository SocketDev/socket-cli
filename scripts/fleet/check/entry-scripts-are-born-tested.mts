/*
 * @file Code-as-law for the new-script contract's test bullet
 *   (docs/agents.md/fleet/self-describing-scripts.md): a NEW repo-owned entry
 *   script is born with a unit test. Scans every `scripts/repo/**` `.mts`
 *   carrying a real top-level entry guard (the same parsed scope test
 *   `entry-scripts-are-self-describing` uses) and flags each one that has no
 *   mirror-named `<name>.test.mts` anywhere under `test/` — unless the
 *   member's `.config/repo/socket-wheelhouse.json` grandfathers it under
 *   `bornTested.grandfathered`.
 *
 *   The grandfather list is a RATCHET, script-owned, never hand-edited:
 *   `--update-baseline` rewrites it to exactly the current untested set, so
 *   enrolling a repo is one run, a script that gains a test falls off the
 *   list on the next update, and a brand-new script can never enter it by
 *   hand without showing up in review as a config diff.
 *
 *   Fleet-owned scripts (`scripts/fleet/**`) are out of scope here: their
 *   tests live in the wheelhouse (`cascaded-fleet-trees-have-no-tests`), so
 *   a member cannot and should not carry them.
 *
 *   Run standalone: `node scripts/fleet/check/entry-scripts-are-born-tested.mts`
 *   Enroll / ratchet: `node scripts/fleet/check/entry-scripts-are-born-tested.mts --update-baseline`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  findSocketWheelhouseConfig,
  loadSocketWheelhouseConfig,
  REPO_ROOT,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { hasTopLevelEntryGuard } from './entry-scripts-are-self-describing.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface Finding {
  // repo-root-relative path of the untested entry script.
  file: string
  // The test filename the mirror-naming convention expects.
  wanted: string
}

/**
 * The grandfathered script list from the member config's `bornTested`
 * section — empty when the config or the section is absent, so a repo with
 * no enrollment holds every entry script to the contract.
 */
export function grandfatheredScripts(repoRoot: string = REPO_ROOT): string[] {
  const config = loadSocketWheelhouseConfig(repoRoot)
  const section = config?.value['bornTested']
  if (typeof section !== 'object' || section === null) {
    return []
  }
  const list = (section as Record<string, unknown>)['grandfathered']
  return Array.isArray(list) ? list.filter(f => typeof f === 'string') : []
}

/**
 * Every repo-owned entry script (top-level entry guard, parsed not
 * regexed) with no mirror-named `<name>.test.mts` under `test/`. Pure over
 * the filesystem snapshot — exported for tests and the baseline writer.
 */
export function scanUntested(repoRoot: string = REPO_ROOT): Finding[] {
  const testNames = new Set(
    globSync(['test/**/*.test.mts'], {
      absolute: false,
      cwd: repoRoot,
      // A workspace member's test tree can sit beside hundreds of installed
      // packages — walking them OOMs the scan (socket-lib, 352 projects).
      ignore: ['**/node_modules/**'],
    }).map(f => path.basename(f)),
  )
  const findings: Finding[] = []
  const files = globSync(['scripts/repo/**/*.mts'], {
    absolute: false,
    cwd: repoRoot,
    ignore: ['**/node_modules/**'],
  })
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text = ''
    try {
      text = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      /* c8 ignore next - glob returned the path moments ago; a read race is not testable */
      continue
    }
    if (!hasTopLevelEntryGuard(text)) {
      continue
    }
    const wanted = `${path.basename(rel, '.mts')}.test.mts`
    if (!testNames.has(wanted)) {
      findings.push({ file: rel, wanted })
    }
  }
  return findings
}

/**
 * Rewrite the config's `bornTested.grandfathered` list to exactly the
 * current untested set — the enrollment run and the ratchet are the same
 * operation. Returns the written list, or `undefined` when the member has no
 * `.config/repo/socket-wheelhouse.json` to hold it.
 */
export function updateBaseline(
  repoRoot: string = REPO_ROOT,
): string[] | undefined {
  const config = loadSocketWheelhouseConfig(repoRoot)
  if (!config) {
    return undefined
  }
  const grandfathered = scanUntested(repoRoot)
    .map(f => f.file)
    .toSorted()
  const next = { ...config.value, bornTested: { grandfathered } }
  writeFileSync(config.location.path, `${JSON.stringify(next, null, 2)}\n`)
  return grandfathered
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every repo-owned entry script is born with a mirror-named unit test (grandfather list is a script-owned ratchet)',
  help: `Usage: node scripts/fleet/check/entry-scripts-are-born-tested.mts [--update-baseline]

  --update-baseline  rewrite bornTested.grandfathered in .config/repo/socket-wheelhouse.json to the current untested set`,
}

export function main(): number {
  if (process.argv.includes('--update-baseline')) {
    const written = updateBaseline()
    const location = findSocketWheelhouseConfig()
    if (written !== undefined && location) {
      // JSON.stringify's reflow is not the repo's JSON style — the formatter
      // owns that, so the write is immediately reformatted rather than
      // leaving churn for a hand-run (code-first-then-ai).
      spawnSync(
        'node',
        [path.join(REPO_ROOT, 'scripts', 'fleet', 'format.mts'), location.path],
        { cwd: REPO_ROOT, stdio: 'ignore' },
      )
    }
    if (written === undefined) {
      logger.error(
        'entry-scripts-are-born-tested: no .config/repo/socket-wheelhouse.json to hold the baseline.\n' +
          '  Where: this repo root.\n' +
          '  Saw:   the member config is absent; wanted the cascaded config file.\n' +
          '  Fix:   run the cascade first, then re-run with --update-baseline.',
      )
      return 1
    }
    logger.log(
      `entry-scripts-are-born-tested: baseline updated — ${written.length} grandfathered script(s).`,
    )
    return 0
  }
  const grandfathered = new Set(grandfatheredScripts())
  const findings = scanUntested().filter(f => !grandfathered.has(f.file))
  if (findings.length === 0) {
    logger.log('✔ every new repo entry script is born with a unit test')
    return 0
  }
  logger.error(
    `entry-scripts-are-born-tested: ${findings.length} entry script(s) have no mirror-named unit test.`,
  )
  logger.error(
    '  A new script is born tested (docs/agents.md/fleet/self-describing-scripts.md); add the test, or ratchet a pre-contract script in via --update-baseline.',
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error(`  • ${f.file} (wanted test/**/${f.wanted})`)
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
