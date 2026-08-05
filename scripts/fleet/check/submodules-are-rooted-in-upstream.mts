/*
 * @file Code-as-law: every submodule lives at the repo root under
 *   `upstream/<name>` — nowhere else. One home makes a reference's role
 *   unmistakable (it is an upstream we pin, port, or conform against), keeps
 *   the untracked-by-default and gitlink rules enforceable with one path
 *   test, and stops per-package nests (`packages/<pkg>/upstream/<name>`,
 *   `test/fixtures/<corpus>`) from drifting into private layouts.
 *
 *   A `.gitmodules` entry whose `path` is not exactly `upstream/<name>` is a
 *   finding — unless the member config grandfathers it under
 *   `submoduleRoots.grandfathered`. The grandfather list is a RATCHET,
 *   script-owned, never hand-edited: `--update-baseline` rewrites it to
 *   exactly the current offender set, so enrolling a repo is one run, a
 *   migrated submodule falls off on the next update, and a NEW nested
 *   submodule can never land quietly.
 *
 *   Run standalone: `node scripts/fleet/check/submodules-are-rooted-in-upstream.mts`
 *   Enroll / ratchet: `node scripts/fleet/check/submodules-are-rooted-in-upstream.mts --update-baseline`
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  findSocketWheelhouseConfig,
  loadSocketWheelhouseConfig,
  REPO_ROOT,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { parseGitmodules } from '../_shared/gitmodules.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface Finding {
  // The `[submodule "<name>"]` block name.
  name: string
  // The offending `path =` value (or '<missing>' when the block has none).
  submodulePath: string
}

/**
 * True when a submodule path sits directly at the repo-root upstream home:
 * `upstream/<name>`, exactly one level deep. Pure — exported for tests.
 */
export function isRootedInUpstream(submodulePath: string): boolean {
  const parts = normalizePath(submodulePath).split('/')
  return parts.length === 2 && parts[0] === 'upstream' && parts[1] !== ''
}

/**
 * The grandfathered submodule-path list from the member config's
 * `submoduleRoots` section — empty when the config or section is absent, so
 * an unenrolled repo holds every entry to the law.
 */
export function grandfatheredSubmodulePaths(
  repoRoot: string = REPO_ROOT,
): string[] {
  const config = loadSocketWheelhouseConfig(repoRoot)
  const section = config?.value['submoduleRoots']
  if (typeof section !== 'object' || section === null) {
    return []
  }
  const list = (section as Record<string, unknown>)['grandfathered']
  return Array.isArray(list) ? list.filter(f => typeof f === 'string') : []
}

/**
 * Every `.gitmodules` entry whose path is not `upstream/<name>`. A repo with
 * no `.gitmodules` has no findings. Pure over the filesystem snapshot —
 * exported for tests and the baseline writer.
 */
export function scanMisrootedSubmodules(
  repoRoot: string = REPO_ROOT,
): Finding[] {
  const gitmodulesPath = path.join(repoRoot, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    return []
  }
  const entries = parseGitmodules(readFileSync(gitmodulesPath, 'utf8'))
  const findings: Finding[] = []
  for (const entry of entries) {
    const submodulePath = entry.path ?? '<missing>'
    if (entry.path === undefined || !isRootedInUpstream(entry.path)) {
      findings.push({ name: entry.name, submodulePath })
    }
  }
  return findings
}

/**
 * Rewrite the config's `submoduleRoots.grandfathered` list to exactly the
 * current offender set — enrollment and the ratchet are the same operation.
 * Returns the written list, or `undefined` when the member has no
 * `.config/repo/socket-wheelhouse.json` to hold it.
 */
export function updateBaseline(
  repoRoot: string = REPO_ROOT,
): string[] | undefined {
  const config = loadSocketWheelhouseConfig(repoRoot)
  if (!config) {
    return undefined
  }
  const grandfathered = scanMisrootedSubmodules(repoRoot)
    .map(f => f.submodulePath)
    .toSorted()
  const next = { ...config.value, submoduleRoots: { grandfathered } }
  writeFileSync(config.location.path, `${JSON.stringify(next, null, 2)}\n`)
  return grandfathered
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every .gitmodules entry lives at the repo-root upstream/<name> home (grandfather list is a script-owned ratchet)',
  help: `Usage: node scripts/fleet/check/submodules-are-rooted-in-upstream.mts [--update-baseline]

  --update-baseline  rewrite submoduleRoots.grandfathered in .config/repo/socket-wheelhouse.json to the current offender set`,
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
        'submodules-are-rooted-in-upstream: no .config/repo/socket-wheelhouse.json to hold the baseline.\n' +
          '  Where: this repo root.\n' +
          '  Saw:   the member config is absent; wanted the cascaded config file.\n' +
          '  Fix:   run the cascade first, then re-run with --update-baseline.',
      )
      return 1
    }
    logger.log(
      `submodules-are-rooted-in-upstream: baseline updated — ${written.length} grandfathered submodule path(s).`,
    )
    return 0
  }
  const grandfathered = new Set(grandfatheredSubmodulePaths())
  const findings = scanMisrootedSubmodules().filter(
    f => !grandfathered.has(f.submodulePath),
  )
  if (findings.length === 0) {
    logger.log('✔ every submodule lives at the repo-root upstream/<name> home')
    return 0
  }
  logger.error(
    `submodules-are-rooted-in-upstream: ${findings.length} submodule(s) live outside the repo-root upstream/ home.`,
  )
  logger.error(
    '  A submodule reference lives at upstream/<name> and nowhere else (docs/agents.md/fleet/upstream-references.md); migrate it, or ratchet a pre-law entry in via --update-baseline.',
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error(`  • [submodule "${f.name}"] path = ${f.submodulePath}`)
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
