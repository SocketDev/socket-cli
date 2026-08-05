#!/usr/bin/env node
/*
 * @file `check --all` gate: git-TRACKED files never include a build OUTPUT. The
 *   only committed generated artifacts are the dep-0 seeds (`fleet.mjs`,
 *   `.npmrc`) — dogfooded, on repo-critical paths, and run before any fetch or
 *   generate step could place them (chicken-and-egg). Everything else the fleet
 *   generates — the hook bundle, dispatch tables, the oxlint plugin bundle, the
 *   snapshot artifacts — is built or fetched, never committed to 16 repos.
 *
 *   Sibling of `ignored-files-are-untracked.mts`, which catches "gitignored yet
 *   tracked." This one closes the gap that one CANNOT see: a build output that
 *   is tracked because nobody added it to the ignore block yet. It knows a path
 *   is an output structurally — from `paths.mts` (the single owner of every
 *   build-output path), never a re-listed copy of the gitignore patterns — so a
 *   NEW output under `_dist/` is caught the moment it is tracked.
 *
 *   Two structural signals (both derived from `paths.mts`, both member-safe —
 *   `paths.mts` cascades; the gitignore-block source does not):
 *     - `_dist/` is EXCLUSIVELY build output: no tracked file may live under it.
 *     - the named generated files in mixed dirs (`_shared/dispatch-table*.mts`,
 *       `excluded-fleet-pack.cjs`, `_shared/dispatch-manifest.json`,
 *       `_shared/generated-validators.mts`, the oxlint `.mjs`) may never be
 *       tracked.
 *
 *   Bundle-placed generated outputs — fleet-pack.cjs, the dispatch table + manifest,
 *   the release manifest's `generatedPaths` — EXIST ON DISK in every member:
 *   the release bundle ships them, the fleet gitignore block ignores them, and
 *   the installer untracks any historically committed copy. On-disk presence is
 *   fine; only TRACKING one is a violation. The three surfaces — producer,
 *   gitignore block, this check — agree by construction, and a wheelhouse
 *   regression test asserts the trio against STAGED_GENERATED_ARTIFACTS.
 *
 *   Runs per-tree (wheelhouse + every member). Fails open when git is
 *   unavailable. Exit: 0 — clean / no git; 1 — a build output is tracked.
 *
 *   Usage: node scripts/fleet/check/generated-outputs-are-untracked.mts [--quiet]
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  DISPATCH_MANIFEST_PATH,
  DISPATCH_TABLE_EXCLUDED_PATH,
  DISPATCH_TABLE_PATH,
  DISPATCH_TABLE_SNAPSHOT_PATH,
  DIST_DIR,
  EXCLUDED_BUNDLE_PATH,
  HOOK_VALIDATORS_PATH,
  OXLINT_PLUGIN_BUNDLE_PATH,
  REPO_ROOT,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The ONLY generated artifacts allowed to be tracked: the dep-0 seeds. Both run
// before any fetch/generate could place them, so committing them is forced by
// the chicken-and-egg, not an oversight. Matched by path tail (mirror-agnostic).
// This is the single hand-maintained list; the generated set is derived below.
export const SANCTIONED_TRACKED_SEEDS: readonly string[] = [
  'scripts/repo/bootstrap/fleet.mjs',
  '.npmrc',
]

/**
 * The repo-root-relative tail of an absolute `paths.mts` constant, normalized
 * to `/`. Matching tracked paths by tail, not exact, is mirror-agnostic: it
 * catches the live copy AND the `template/base/` mirror without listing both.
 */
export function outputTail(absPath: string): string {
  return normalizePath(path.relative(REPO_ROOT, absPath))
}

export interface GeneratedTrackingConfig {
  readonly outputDirTails: readonly string[]
  readonly outputFileTails: readonly string[]
  readonly seedTails: readonly string[]
}

/**
 * Pure verdict: which tracked paths are build outputs that must not be tracked.
 * A path violates if it lives under an output DIR tail or equals an output FILE
 * tail, tail-match tolerates any mirror prefix, and is not a sanctioned seed.
 */
export function collectGeneratedTrackingViolations(
  trackedPaths: readonly string[],
  config: GeneratedTrackingConfig,
): string[] {
  const { outputDirTails, outputFileTails, seedTails } = config
  const violations: string[] = []
  for (const raw of trackedPaths) {
    const p = normalizePath(raw)
    if (seedTails.some(seed => p === seed || p.endsWith(`/${seed}`))) {
      continue
    }
    const underDir = outputDirTails.some(
      dir => p.includes(`/${dir}/`) || p.startsWith(`${dir}/`),
    )
    const isFile = outputFileTails.some(
      file => p === file || p.endsWith(`/${file}`),
    )
    if (underDir || isFile) {
      violations.push(p)
    }
  }
  return violations.toSorted()
}

async function trackedFiles(): Promise<string[] | undefined> {
  try {
    const result = (await spawn('git', ['ls-files'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return String(result?.stdout ?? '')
      .split('\n')
      .filter(line => line !== '')
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const tracked = await trackedFiles()
  if (tracked === undefined) {
    // git unavailable — vacuous, never a false-green failure on a non-git tree.
    process.exitCode = 0
    return
  }
  const violations = collectGeneratedTrackingViolations(tracked, {
    outputDirTails: [outputTail(DIST_DIR)],
    outputFileTails: [
      DISPATCH_TABLE_PATH,
      DISPATCH_TABLE_SNAPSHOT_PATH,
      DISPATCH_TABLE_EXCLUDED_PATH,
      EXCLUDED_BUNDLE_PATH,
      DISPATCH_MANIFEST_PATH,
      HOOK_VALIDATORS_PATH,
      OXLINT_PLUGIN_BUNDLE_PATH,
    ].map(outputTail),
    seedTails: SANCTIONED_TRACKED_SEEDS,
  })
  if (violations.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log('generated-outputs-are-untracked: no build output is tracked.')
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `generated-outputs-are-untracked: ${violations.length} build output(s) are git-tracked:`,
  )
  for (let i = 0, { length } = violations; i < length; i += 1) {
    logger.fail(`  ${violations[i]!}`)
  }
  logger.fail(
    '  What:  a generated build output (bundle / dispatch table / oxlint plugin\n' +
      '         / anything under _dist/) is committed. Only the dep-0 seeds\n' +
      '         (fleet.mjs, .npmrc) may be tracked — everything else is built or fetched.\n' +
      '  Where: the path(s) above.\n' +
      '  Wanted: build outputs stay out of version control (16 repos never carry them).\n' +
      '  Fix:   `git rm --cached <path>` and add its pattern to the fleet gitignore\n' +
      '         block (scripts/repo/sync-scaffolding/checks/gitignore-fleet-block.mts),\n' +
      '         then re-cascade. If it is genuinely a new dep-0 seed, add it to\n' +
      '         SANCTIONED_TRACKED_SEEDS with a one-line justification.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'verifies no git-tracked file is a generated build output',
  help: `Usage: node scripts/fleet/check/generated-outputs-are-untracked.mts [flags]

  --quiet  suppress the success message`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
