/**
 * @file Unified check runner — delegates to lint + type + path-hygiene.
 *   Forwards CLI scope flags to the lint script so `pnpm run check --all`
 *   actually runs a full-scope lint (not the default modified-only scope).
 *   `pnpm type` doesn't accept our scope flags, so it's always a full check.
 *   Usage: pnpm run check # lint in modified scope + full type check +
 *   path-hygiene pnpm run check --staged # lint staged + full type + paths pnpm
 *   run check --all # full lint + full type + paths (CI) Byte-identical across
 *   every fleet repo. Sync-scaffolding flags drift. The step list itself lives
 *   in _shared/check-steps.mts (+ its domain-split siblings) — this file owns
 *   CLI scope parsing and the run loop.
 */

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { buildSteps, run } from './_shared/check-steps.mts'
import { discoverRepoChecks } from './_shared/repo-checks.mts'
import { isScopeFlag } from './_shared/scope-flags.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

export { buildSteps, run }

const logger = getDefaultLogger()

// The `git status --porcelain` snapshot of the working tree, or undefined when
// git is unavailable / this isn't a repo (the guard then fails open — a
// non-git checkout can't be diffed, so it's un-guardable, not a violation).
// --porcelain omits gitignored paths, so a check that rebuilds a gitignored
// artifact (the _dispatch/*.cjs bundles, coverage/) is NOT a false positive;
// only TRACKED-file mutations count.
function gitPorcelain(): string | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI runner; the tree snapshot must complete inline before/after the sequential gate loop.
  const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  return r.status === 0 ? String(r.stdout ?? '') : undefined
}

/**
 * The porcelain lines present AFTER a check run that weren't there BEFORE — the
 * tree mutations a read-only check run introduced. Pure; exported for tests.
 * Pre-existing dirt appears in both snapshots and is excluded.
 */
export function treeMutationDelta(before: string, after: string): string[] {
  const seen = new Set(before.split('\n').filter(Boolean))
  return after
    .split('\n')
    .filter(Boolean)
    .filter(line => !seen.has(line))
}

// True when `arg` is one of the flags check.mts forwards to lint.mts — --fix,
// --quiet, or a scope flag (--all/--staged/…).
export function isForwardedArg(arg: string): boolean {
  return arg === '--fix' || arg === '--quiet' || isScopeFlag(arg)
}

export function computeForwardedArgs(argv: string[]): string[] {
  return argv.filter(isForwardedArg)
}

// Parallel width for the read-only check pool: all cores but one (leave the box
// responsive). Each check is its own subprocess, so this caps CONCURRENT spawns,
// not the total check count.
const CONCURRENCY = Math.max(1, (os.availableParallelism?.() ?? 4) - 1)

// Repo-tier (auto-discovered) checks that are RELEASE/CI-only — the heavy
// wall-clock long poles a dev's inner loop shouldn't pay: dogfood-is-current
// (nested node→sync full-manifest tree-hash, ~12s) + the github-settings
// network audit. Skipped on the interactive tier; run under --release / CI. The
// fleet-tier counterparts use releaseStep() in check-steps-release.mts.
const RELEASE_TIER_REPO_CHECKS: ReadonlySet<string> = new Set([
  'dogfood-is-current.mts',
  'github-settings-are-conformant.mts',
  // Wheelhouse dogfood law: dispatch must be on the snapshot fast path. Held to
  // the release tier (pre-push / --release) rather than the interactive inner
  // loop because the per-host launcher binary is gitignored + can be reaped
  // between runs (a cascade/dogfood quarantine of untracked _dispatch files), so
  // a hard interactive gate would flap. Enforced where it's stable: before a push.
  'hook-snapshot-is-active.mts',
])

/**
 * Drain `items` through `worker` with at most `limit` in flight. Each lane
 * pulls the next index until the queue empties; resolves when every lane
 * finishes. Exported for tests.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const idx = next
        next += 1
        // eslint-disable-next-line no-await-in-loop -- a pool lane drains its queue serially by design
        await worker(items[idx]!)
      }
    },
  )
  await Promise.all(lanes)
}

export async function main(): Promise<void> {
  // Warm ONE shared V8 compile cache across every spawned check subprocess. The
  // lib spawn spreads process.env into children, so setting the env var here
  // (NOT enableCompileCache(), which would cache only this parent's modules)
  // means each `node scripts/fleet/check/<x>.mts` reuses cached bytecode for the
  // shared import graph (lib-stable errors/message + logger/default + paths.mts
  // + is-main-module.mts) and the tsc step reuses compiled typescript.js. Env
  // var — not the API call — because only the var propagates to children (Node
  // >= 22.8). node_modules/.cache is gitignored; pure perf, uncached is correct,
  // so a sandbox that forbids the dir just prints a warning and runs cold.
  if (!process.env['NODE_COMPILE_CACHE']) {
    process.env['NODE_COMPILE_CACHE'] = path.join(
      REPO_ROOT,
      'node_modules',
      '.cache',
      'fleet-checks',
    )
  }

  // Release/CI tier: --release (pre-push-gate passes it) or CI (GitHub Actions
  // sets CI=true) opts into the heavy long poles + network/release-verification
  // checks. The interactive default runs the FAST tier only (~seconds) — the
  // long poles are still enforced before every push/merge, never silently
  // dropped. releaseStep() reads this env var in the fleet registries.
  const releaseMode = process.argv.includes('--release') || getCI()
  if (releaseMode) {
    process.env['FLEET_CHECK_RELEASE'] = '1'
  }

  const forwardedArgs = computeForwardedArgs(process.argv.slice(2))
  const steps = buildSteps(forwardedArgs)

  // Repo-owned checks: a member extends `check --all` by dropping
  // assertion-named scripts into scripts/repo/check/ (fleet/repo
  // segmentation — a one-repo concern never enters the fleet tier).
  // Appended after the fleet steps; vacuous when the dir is absent. On the
  // interactive tier the RELEASE_TIER_REPO_CHECKS long poles are held back.
  let skippedReleaseChecks = 0
  for (const rel of discoverRepoChecks(REPO_ROOT)) {
    if (!releaseMode && RELEASE_TIER_REPO_CHECKS.has(path.basename(rel))) {
      skippedReleaseChecks += 1
      continue
    }
    steps.push(() => run('node', [rel]))
  }

  // Read-only invariant: a check run WITHOUT --fix must not mutate the tree. A
  // check that writes on its argless path (the runner invokes every check
  // argless) silently drifts a TRACKED file and hard-fails a later gate — past
  // incident: template-fleet-oxlint-ignore-current re-spliced oxlintrc.json
  // during `check --all`, which then tripped dogfood-is-current on the next
  // run. Snapshot around the run and fail naming the offending paths. Skipped
  // in --fix mode (fixers are meant to write) and fail-open outside git.
  const isFix = forwardedArgs.includes('--fix')
  const before = isFix ? undefined : gitPorcelain()

  // Write a check's captured block atomically, newline-terminated so adjacent
  // blocks never run together (some checks don't trail a newline).
  const emit = (r: { output: string }): void => {
    if (r.output) {
      process.stdout.write(r.output.endsWith('\n') ? r.output : `${r.output}\n`)
    }
  }

  if (isFix) {
    // --fix steps MUTATE (lint --fix, generators): serial + fail-fast so writes
    // never race and dependent order holds.
    for (let i = 0, { length } = steps; i < length; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- serial fixer chain: order matters + no write races
      const r = await steps[i]!()
      emit(r)
      if (!r.ok) {
        process.exitCode = 1
        break
      }
    }
  } else {
    // Read-only checks run CONCURRENTLY (the read-only-tree guard proves they
    // don't write, so there's no race). NO fail-fast — every step runs, so one
    // pass surfaces EVERY failure instead of one-per-rerun. Each check's block
    // is captured + written atomically on completion (progress, never interleaved).
    const failedLabels: string[] = []
    await runPool(steps, CONCURRENCY, async step => {
      const r = await step()
      emit(r)
      if (r.skipped) {
        skippedReleaseChecks += 1
      }
      if (!r.ok) {
        failedLabels.push(r.label)
      }
    })
    if (failedLabels.length) {
      logger.error(
        `\n[check] ${failedLabels.length} check(s) failed: ${failedLabels.join(', ')}`,
      )
      process.exitCode = 1
    }
    if (skippedReleaseChecks > 0) {
      logger.log(
        `[check] ${skippedReleaseChecks} release/CI-only check(s) skipped on the interactive tier — ` +
          'run `pnpm run check --all --release` (or CI) for the full set.',
      )
    }
  }

  if (before !== undefined) {
    const after = gitPorcelain()
    const mutated = after === undefined ? [] : treeMutationDelta(before, after)
    if (mutated.length) {
      logger.error(
        '[check] a check mutated the working tree during a read-only run —',
      )
      logger.error(
        '  a check must be read-only unless --fix. Gate every write behind a',
      )
      logger.error('  --fix/--write/--update flag. Paths touched:')
      for (let i = 0, { length } = mutated; i < length; i += 1) {
        logger.error(`    ${mutated[i]!}`)
      }
      process.exitCode = 1
    }
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
