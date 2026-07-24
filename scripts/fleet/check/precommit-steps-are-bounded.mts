#!/usr/bin/env node
/**
 * @file Enforce the pre-commit time gate. The pre-commit hook must stay fast
 *   (≤ PRECOMMIT_STEP_BUDGET_CAP_S) so a commit never hangs: every heavy
 *   optional step (`pnpm lint`, `pnpm test`) has to run through the bounded
 *   runner (`run_step_bounded`, which kills the process group on timeout and
 *   fails open), and the declared budget must stay at or under the cap. A bare
 *   or `run_step` (unbounded) heavy step, or a budget above the cap, re-opens
 *   the "commit hangs forever" hole this gate closes.
 *   Pure core (findUnboundedHeavySteps / readBudgetSeconds) is unit-tested;
 *   main() reads the repo's own .git-hooks/fleet/pre-commit and fails loud.
 *   Usage: node scripts/fleet/check/precommit-steps-are-bounded.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The pre-commit budget ceiling. The hook declares PRECOMMIT_STEP_BUDGET_S;
// it must not drift above this (a bigger budget = a slower worst-case commit).
export const PRECOMMIT_STEP_BUDGET_CAP_S = 10

// Heavy optional steps that MUST be bounded. Sorted (socket/sort).
export const HEAVY_STEP_COMMANDS: readonly string[] = ['pnpm lint', 'pnpm test']

// The bounded-runner shell function every heavy step must be invoked through.
const BOUNDED_RUNNER = 'run_step_bounded'

const HOOK_PATH = path.join('.git-hooks', 'fleet', 'pre-commit')

function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith('#')
}

/**
 * Heavy steps invoked WITHOUT the bounded runner. A line that runs a heavy
 * command must start with `run_step_bounded ` — a bare invocation or the
 * unbounded `run_step ` form is a finding. Comment lines are ignored (the
 * runner's own doc mentions the commands in prose).
 */
export function findUnboundedHeavySteps(hookText: string): string[] {
  const findings: string[] = []
  const lines = hookText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line || isCommentLine(line)) {
      continue
    }
    for (let j = 0, jlen = HEAVY_STEP_COMMANDS.length; j < jlen; j += 1) {
      const cmd = HEAVY_STEP_COMMANDS[j]!
      if (line.includes(cmd) && !line.startsWith(`${BOUNDED_RUNNER} `)) {
        findings.push(`${cmd} (line ${i + 1})`)
      }
    }
  }
  return findings
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
  const budget = readBudgetSeconds(hookText)

  const errors: string[] = []
  if (unbounded.length > 0) {
    errors.push(
      `Unbounded heavy step(s): ${unbounded.join(', ')}.\n` +
        `  Where: ${HOOK_PATH}.\n` +
        `  Saw: a heavy command run bare or via unbounded run_step; ` +
        `wanted: every heavy step invoked through ${BOUNDED_RUNNER}.\n` +
        `  Fix: prefix the invocation with ${BOUNDED_RUNNER} <name>.`,
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
