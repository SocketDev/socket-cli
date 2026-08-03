/**
 * @file Canonical `clean` for socket-* repos — the `clean` package.json script
 *   routes through here. Removes this repo's build output: the JS bundle dirs
 *   (`dist/`, `build/`), the native crate output (`target/`), the coverage
 *   report dir, the generated template tree, and the same set inside every
 *   workspace package. A repo that does not produce one of those has no such
 *   directory and the delete is a no-op, so one list serves every repo shape.
 *   The cache root is NOT build output. `.cache/` sits at the repo root so it
 *   OUTLIVES a clean: hook processes write the bundle cache and the
 *   active-edits ledger while a build runs, and a sweep that takes the cache
 *   with it dies on `ENOTEMPTY` mid-run. Removing it is opt-in (`--cache`),
 *   never the default. Same for `node_modules/` (`--node-modules`).
 *   Usage: `node scripts/fleet/clean.mts` removes build output;
 *   `--cache` also removes `.cache/`; `--node-modules` also removes
 *   `node_modules/`; `--all` does both; `--dry-run` lists without deleting;
 *   `--quiet` suppresses the summary.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from './_shared/is-main-module.mts'
import { NODE_MODULES_DIR, REPO_ROOT, TOOL_CACHE_DIR } from './paths.mts'

const logger = getDefaultLogger()

/**
 * Build-output directories a fleet repo may produce, relative to the repo root.
 */
export const FLEET_OUTPUT_DIRS: readonly string[] = [
  'build',
  'coverage',
  'dist',
  'target',
  'template/generated',
]

/**
 * The same output directories one level inside a pnpm workspace package. Glob
 * form so a `mono` repo cleans every package without enumerating them, and a
 * `solo` repo matches nothing.
 */
export const WORKSPACE_OUTPUT_GLOBS: readonly string[] = FLEET_OUTPUT_DIRS.map(
  dir => `packages/*/${dir}`,
)

export interface CleanOptions {
  /**
   * Also remove the repo-root `.cache/` tool-cache root.
   */
  readonly cache?: boolean | undefined
  /**
   * Also remove `node_modules/`.
   */
  readonly nodeModules?: boolean | undefined
}

export interface CleanPlan {
  /**
   * Absolute paths and globs handed to `safeDelete`.
   */
  readonly targets: readonly string[]
  /**
   * The subset that exists right now — what the summary counts.
   */
  readonly present: readonly string[]
}

/**
 * Everything a clean of `repoRoot` would remove. Pure apart from the existence
 * probe that fills `present`, so a test can assert the target set without
 * deleting anything.
 */
export function resolveCleanPlan(
  repoRoot: string,
  options?: CleanOptions | undefined,
): CleanPlan {
  const opts = { __proto__: null, ...options } as CleanOptions
  const targets = [...FLEET_OUTPUT_DIRS, ...WORKSPACE_OUTPUT_GLOBS].map(entry =>
    path.join(repoRoot, entry),
  )
  if (opts.cache) {
    targets.push(path.join(repoRoot, path.relative(REPO_ROOT, TOOL_CACHE_DIR)))
  }
  if (opts.nodeModules) {
    targets.push(
      path.join(repoRoot, path.relative(REPO_ROOT, NODE_MODULES_DIR)),
    )
  }
  // A glob cannot be probed with existsSync, so `present` counts the literal
  // paths only — enough for the operator-facing summary.
  const present = targets.filter(
    entry => !entry.includes('*') && existsSync(entry),
  )
  return { present, targets }
}

/**
 * Delete every planned path. `safeDelete` refuses to escape the repo root
 * without `force`, and the retry window absorbs a concurrent writer holding a
 * directory entry open — the `ENOTEMPTY` a plain recursive remove loses to.
 */
export async function runClean(plan: CleanPlan): Promise<void> {
  await safeDelete([...plan.targets], {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  })
}

export interface CleanArgs {
  readonly dryRun: boolean
  readonly options: CleanOptions
  readonly quiet: boolean
}

/**
 * Reduce argv to the flags this script honors. `--all` is the union of the two
 * opt-in sweeps, never a wider one.
 */
export function parseCleanArgs(argv: readonly string[]): CleanArgs {
  const all = argv.includes('--all')
  return {
    dryRun: argv.includes('--dry-run'),
    options: {
      cache: all || argv.includes('--cache'),
      nodeModules: all || argv.includes('--node-modules'),
    },
    quiet: argv.includes('--quiet'),
  }
}

async function main(): Promise<void> {
  const { dryRun, options, quiet } = parseCleanArgs(process.argv.slice(2))
  const plan = resolveCleanPlan(REPO_ROOT, options)

  if (dryRun) {
    if (!plan.present.length) {
      logger.info('[clean] nothing to remove.')
      return
    }
    logger.info(`[clean] would remove ${plan.present.length} path(s):`)
    for (let i = 0, { length } = plan.present; i < length; i += 1) {
      logger.info(`  ${path.relative(REPO_ROOT, plan.present[i]!)}`)
    }
    return
  }

  const { length: removed } = plan.present
  await runClean(plan)

  if (!quiet) {
    if (removed) {
      logger.success(`[clean] removed ${removed} path(s).`)
    } else {
      logger.info('[clean] nothing to remove.')
    }
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`[clean] failed: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
