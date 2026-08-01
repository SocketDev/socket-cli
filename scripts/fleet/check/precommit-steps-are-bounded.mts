#!/usr/bin/env node
/**
 * @file Enforce the pre-commit time gate. The pre-commit hook must stay fast
 *   (≤ PRECOMMIT_STEP_BUDGET_CAP_S) so a commit never hangs: every heavy
 *   optional step (the `lint` and `test` package scripts) has to run through a
 *   bounded runner (`run_pkg_step_bounded` / `run_step_bounded`, which kill the
 *   process group on timeout and fail open), the declared budget must stay at
 *   or under the cap, and the hook must render the ungated-step summary so a
 *   killed step can't read as a pass. A heavy step run bare or via the
 *   unbounded `run_step`, a heavy step missing entirely, a budget above the
 *   cap, or a missing summary each re-opens a hole this gate closes.
 *   Pure core (findMissingHeavySteps / findUnboundedHeavySteps /
 *   heavyScriptsOnLine / readBudgetSeconds / rendersGateSummary) is
 *   unit-tested; main() reads the repo's own .git-hooks/fleet/pre-commit and
 *   fails loud.
 *   Usage: node scripts/fleet/check/precommit-steps-are-bounded.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The pre-commit budget ceiling. The hook declares PRECOMMIT_STEP_BUDGET_S;
// it must not drift above this (a bigger budget = a slower worst-case commit).
export const PRECOMMIT_STEP_BUDGET_CAP_S = 10

// Heavy optional steps that MUST be bounded, named by the package.json script
// each one runs. Sorted (socket/sort).
export const HEAVY_STEP_SCRIPTS: readonly string[] = ['lint', 'test']

// The bounded-runner shell functions a heavy step may be invoked through.
// `run_pkg_step_bounded` resolves the package.json script body and runs it
// directly (skipping pnpm's startup); `run_step_bounded` takes a literal argv.
// Both background the command in its own process group and kill it at the
// budget. Sorted (socket/sort).
export const BOUNDED_RUNNERS: readonly string[] = [
  'run_pkg_step_bounded',
  'run_step_bounded',
]

// The shell function that names every step which did not gate the commit. A
// hook that skips a step without calling this reports the skip as a pass.
export const GATE_SUMMARY_FN = 'precommit_gate_summary'

const HOOK_PATH = path.join('.git-hooks', 'fleet', 'pre-commit')

// The shared step-runner the hook sources; the budget declaration lives here
// (one home for the run_step* family and their budget).
const RUN_STEP_PATH = path.join('.git-hooks', '_shared', 'run-step.sh')

function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith('#')
}

function isBoundedLine(line: string): boolean {
  for (let i = 0, { length } = BOUNDED_RUNNERS; i < length; i += 1) {
    if (line.startsWith(`${BOUNDED_RUNNERS[i]!} `)) {
      return true
    }
  }
  return false
}

/**
 * The heavy package scripts a single hook line invokes, in any of the three
 * forms a hook can take: the resolving runner (`run_pkg_step_bounded lint`),
 * the pnpm wrapper (`pnpm --config.x=y lint`, flags may sit between the binary
 * and the script name), and a hard-coded direct call (`node
 * scripts/fleet/lint.mts`). Recognizing all three is what keeps this check from
 * passing vacuously when the hook switches invocation style.
 */
export function heavyScriptsOnLine(line: string): string[] {
  const tokens = line.trim().split(/\s+/)
  const pnpmAt = tokens.indexOf('pnpm')
  const nodeAt = tokens.indexOf('node')
  const found: string[] = []
  for (let i = 0, { length } = HEAVY_STEP_SCRIPTS; i < length; i += 1) {
    const script = HEAVY_STEP_SCRIPTS[i]!
    if (tokens[0] === 'run_pkg_step_bounded' && tokens[1] === script) {
      found.push(script)
      continue
    }
    if (pnpmAt !== -1) {
      let k = pnpmAt + 1
      while (k < tokens.length && tokens[k]!.startsWith('-')) {
        k += 1
      }
      if (tokens[k] === script) {
        found.push(script)
        continue
      }
    }
    if (nodeAt !== -1 && tokens[nodeAt + 1] !== undefined) {
      const target = normalizePath(tokens[nodeAt + 1]!)
      if (target === `${script}.mts` || target.endsWith(`/${script}.mts`)) {
        found.push(script)
      }
    }
  }
  return found
}

/**
 * Heavy steps invoked WITHOUT a bounded runner. Comment lines are ignored (the
 * runner's own doc mentions the commands in prose).
 */
export function findUnboundedHeavySteps(hookText: string): string[] {
  const findings: string[] = []
  const lines = hookText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line || isCommentLine(line) || isBoundedLine(line)) {
      continue
    }
    const scripts = heavyScriptsOnLine(line)
    for (let j = 0, jlen = scripts.length; j < jlen; j += 1) {
      findings.push(`${scripts[j]!} (line ${i + 1})`)
    }
  }
  return findings
}

/**
 * Heavy steps the hook never invokes at all. A gate that dropped its lint or
 * test step is silently ungated — the worst false green of the three, because
 * nothing in the commit output hints the step is gone.
 */
export function findMissingHeavySteps(hookText: string): string[] {
  const invoked = new Set<string>()
  const lines = hookText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line || isCommentLine(line)) {
      continue
    }
    const scripts = heavyScriptsOnLine(line)
    for (let j = 0, jlen = scripts.length; j < jlen; j += 1) {
      invoked.add(scripts[j]!)
    }
  }
  return HEAVY_STEP_SCRIPTS.filter(script => !invoked.has(script))
}

/**
 * True when the hook calls the ungated-step summary. Without it a step the
 * budget killed prints its notice mid-log and the commit still ends clean.
 */
export function rendersGateSummary(hookText: string): boolean {
  const lines = hookText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!isCommentLine(line) && line.split(/\s+/)[0] === GATE_SUMMARY_FN) {
      return true
    }
  }
  return false
}

/**
 * The declared PRECOMMIT_STEP_BUDGET_S in seconds, or undefined when the hook
 * declares no budget (itself a finding — an unbounded hook).
 */
export function readBudgetSeconds(hookText: string): number | undefined {
  const match = /^PRECOMMIT_STEP_BUDGET_S=(\d+)/m.exec(hookText)
  return match ? Number(match[1]) : undefined
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(HOOK_PATH)) {
    // No fleet pre-commit hook in this repo — nothing to bound.
    if (!quiet) {
      logger.log(`[precommit-steps-are-bounded] no ${HOOK_PATH}; skipping.`)
    }
    return
  }
  const hookText = readFileSync(HOOK_PATH, 'utf8')
  const unbounded = findUnboundedHeavySteps(hookText)
  const missing = findMissingHeavySteps(hookText)
  // The budget lives in the shared runner the hook sources; older hooks
  // declared it inline, so both homes are read.
  const runStepText = existsSync(RUN_STEP_PATH)
    ? readFileSync(RUN_STEP_PATH, 'utf8')
    : ''
  const budget = readBudgetSeconds(hookText) ?? readBudgetSeconds(runStepText)

  const errors: string[] = []
  if (unbounded.length > 0) {
    errors.push(
      `Unbounded heavy step(s): ${unbounded.join(', ')}.\n` +
        `  Where: ${HOOK_PATH}.\n` +
        `  Saw: a heavy step run bare or via unbounded run_step; ` +
        `wanted: every heavy step invoked through one of ` +
        `${BOUNDED_RUNNERS.join(' / ')}.\n` +
        `  Fix: prefix the invocation with run_pkg_step_bounded <script>.`,
    )
  }
  if (missing.length > 0) {
    errors.push(
      `Missing heavy step(s): ${missing.join(', ')}.\n` +
        `  Where: ${HOOK_PATH}.\n` +
        `  Saw: no invocation of the ${missing.join(' / ')} script; ` +
        `wanted: every heavy step in ${HEAVY_STEP_SCRIPTS.join(' / ')} run ` +
        `on every commit.\n` +
        `  Fix: add \`run_pkg_step_bounded ${missing[0]!} --staged\` to the hook.`,
    )
  }
  if (!rendersGateSummary(hookText)) {
    errors.push(
      `No ${GATE_SUMMARY_FN} call.\n` +
        `  Where: ${HOOK_PATH}.\n` +
        `  Saw: no summary; wanted: a call to ${GATE_SUMMARY_FN} after the ` +
        `last step, so a step the budget killed (or one that checked zero ` +
        `files) is named instead of reading as a pass.\n` +
        `  Fix: add \`${GATE_SUMMARY_FN}\` as the hook's last line.`,
    )
  }
  if (budget === undefined) {
    errors.push(
      `No PRECOMMIT_STEP_BUDGET_S declared.\n` +
        `  Where: ${HOOK_PATH}.\n` +
        `  Saw: no budget; wanted: PRECOMMIT_STEP_BUDGET_S=<seconds> ` +
        `at or under ${PRECOMMIT_STEP_BUDGET_CAP_S}.\n` +
        `  Fix: declare the budget the bounded runner reads.`,
    )
  } else if (budget > PRECOMMIT_STEP_BUDGET_CAP_S) {
    errors.push(
      `PRECOMMIT_STEP_BUDGET_S=${budget} exceeds the cap.\n` +
        `  Where: ${HOOK_PATH}.\n` +
        `  Saw: ${budget}s; wanted: ≤ ${PRECOMMIT_STEP_BUDGET_CAP_S}s ` +
        `(a commit must never hang past the budget).\n` +
        `  Fix: lower PRECOMMIT_STEP_BUDGET_S to ≤ ${PRECOMMIT_STEP_BUDGET_CAP_S}.`,
    )
  }

  if (errors.length > 0) {
    logger.fail('[precommit-steps-are-bounded]')
    for (let i = 0, { length } = errors; i < length; i += 1) {
      if (i > 0) {
        logger.error('')
      }
      logger.error(errors[i]!)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[precommit-steps-are-bounded] pre-commit steps bounded ` +
        `(budget ${budget}s ≤ ${PRECOMMIT_STEP_BUDGET_CAP_S}s).`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
