#!/usr/bin/env node
/**
 * @file The unified check runner: lint plus type check, aggregated. Both steps
 *   always run, so one invocation surfaces every failure instead of one per
 *   rerun, and the run ends with a one-line-per-step verdict naming exactly
 *   what failed.
 *
 *   Scope flags are forwarded to the lint step, so `pnpm run check --all` runs
 *   a full-workspace lint rather than the default modified-only scope. The type
 *   check does not take a scope: tsgo reads the whole program, so it is always
 *   a full check.
 *
 *   Read-only contract: a run without `--fix` must not touch the working tree.
 *   The tree is snapshotted before and after, and a step that wrote to a
 *   tracked file fails the run naming the paths. A check that quietly rewrites
 *   a tracked file drifts the repo and hard-fails a later gate.
 *
 *   Usage:
 *     node scripts/check.mts [--all|--staged|--modified] [--fix] [--quiet]
 */

import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'

import { isMainModule } from './lib/is-main-module.mts'
import { REPO_ROOT, laneEnv } from './lib/linters.mts'
import { runMain } from './lib/run-main.mts'
import { isScopeFlag } from './lib/scope.mts'

import type { ScriptMeta } from './lib/run-main.mts'

/** One step's outcome: its label, verdict, and full captured output. */
export interface StepResult {
  readonly label: string
  readonly ok: boolean
  readonly output: string
}

/** A step spawns its subprocess and resolves a {@link StepResult}. */
export type CheckStep = () => Promise<StepResult>

/**
 * True when `arg` is one of the flags `check` hands to the lint step: a scope
 * flag, `--fix`, or `--quiet`. Everything else stays here. Pure.
 */
export function isForwardedArg(arg: string): boolean {
  return arg === '--fix' || arg === '--quiet' || isScopeFlag(arg)
}

/** The subset of `argv` the lint step receives. Pure — exported for tests. */
export function computeForwardedArgs(argv: readonly string[]): string[] {
  return argv.filter(isForwardedArg)
}

/**
 * Run `command` with `args`, capturing stdout and stderr so the runner can
 * print each step's block atomically. Concurrent steps would otherwise
 * interleave their streams into noise. Never rejects: the runner aggregates
 * verdicts and must not have to catch.
 */
export function runStep(
  label: string,
  command: string,
  args: readonly string[],
): Promise<StepResult> {
  return new Promise<StepResult>(resolve => {
    const child = spawn(command, [...args], {
      cwd: REPO_ROOT,
      env: laneEnv(),
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      output += chunk
    })
    child.on('error', (e: Error) => {
      resolve({
        label,
        ok: false,
        output: `${output}${label} did not start: ${e.message}\n`,
      })
    })
    child.on('close', (code: number | null) => {
      resolve({ label, ok: code === 0, output })
    })
  })
}

/**
 * The `git status --porcelain` snapshot of the working tree, or undefined when
 * git is unavailable or this is not a repo — an un-diffable checkout is
 * un-guardable, not a violation, so the guard fails open. Gitignored paths are
 * omitted, so a step that rebuilds a gitignored artifact is not a false
 * positive; only tracked-file changes count.
 */
function gitPorcelain(): string | undefined {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return result.status === 0 ? String(result.stdout ?? '') : undefined
}

/**
 * The porcelain lines present after a run that were not there before — the
 * tree changes a read-only run introduced. Pre-existing dirt appears in both
 * snapshots and is excluded. Pure — exported for tests.
 */
export function treeMutationDelta(before: string, after: string): string[] {
  const seen = new Set(before.split('\n').filter(Boolean))
  return after
    .split('\n')
    .filter(Boolean)
    .filter(line => !seen.has(line))
}

/**
 * The aggregate verdict for a finished run, or an empty string when every step
 * passed. Pure — exported for tests.
 */
export function renderCheckSummary(results: readonly StepResult[]): string {
  const failed = results.filter(r => !r.ok)
  if (!failed.length) {
    return ''
  }
  return [
    `[check] ${failed.length} of ${results.length} step(s) failed:`,
    ...failed.map(r => `  ${r.label}`),
  ].join('\n')
}

/**
 * The step list: the scoped lint runner, then the full type check. Both are
 * spawned through this process's own Node binary or the repo's local bin dir,
 * never a globally installed copy.
 */
export function buildSteps(forwardedArgs: readonly string[]): CheckStep[] {
  return [
    () =>
      runStep('lint', process.execPath, ['scripts/lint.mts', ...forwardedArgs]),
    () => runStep('tsc:src', 'tsgo', []),
    () =>
      runStep('tsc:scripts', 'tsgo', ['--project', 'tsconfig.scripts.json']),
  ]
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const forwardedArgs = computeForwardedArgs(argv)
  const isFix = forwardedArgs.includes('--fix')
  const steps = buildSteps(forwardedArgs)

  const before = isFix ? undefined : gitPorcelain()

  const emit = (result: StepResult): void => {
    if (result.output) {
      process.stdout.write(
        result.output.endsWith('\n') ? result.output : `${result.output}\n`,
      )
    }
  }

  let results: StepResult[]
  if (isFix) {
    // Fix steps mutate, so they run serially and stop at the first failure:
    // order matters and concurrent writers would race the same files.
    results = []
    for (const step of steps) {
      // eslint-disable-next-line no-await-in-loop -- serial fixer chain: order matters and concurrent writes would race
      const result = await step()
      emit(result)
      results.push(result)
      if (!result.ok) {
        break
      }
    }
  } else {
    // Read-only steps run concurrently — the tree guard below proves they do
    // not write, so there is no race — and none of them short-circuits the
    // others, so one pass reports every failure.
    results = await Promise.all(steps.map(step => step()))
    for (const result of results) {
      emit(result)
    }
  }

  let exitCode = 0
  const summary = renderCheckSummary(results)
  if (summary) {
    process.stderr.write(`${summary}\n`)
    exitCode = 1
  } else {
    process.stdout.write('[check] passed\n')
  }

  if (before !== undefined) {
    const after = gitPorcelain()
    const mutated = after === undefined ? [] : treeMutationDelta(before, after)
    if (mutated.length) {
      process.stderr.write(
        '[check] a step changed the working tree during a read-only run\n' +
          '  Where: scripts/check.mts, between the before and after snapshots.\n' +
          '  Saw: tracked paths modified by a run without --fix; wanted no writes at all.\n' +
          '  Fix: gate the write behind --fix. Paths touched:\n' +
          mutated.map(line => `    ${line}\n`).join(''),
      )
      exitCode = 1
    }
  }

  return exitCode
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'runs the aggregated check suite — scoped lint plus a full type check — and reports every failure in one pass',
  help: `Usage: pnpm run check [flags]

  --modified, --changed  lint files modified vs HEAD (the default)
  --staged               lint the files in the git index
  --all                  lint the entire workspace
  --fix                  run the steps in autofix mode, serially
  --quiet                suppress the lint step's progress output

  The type check has no scope: tsgo always reads the whole program.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
