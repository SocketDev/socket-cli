#!/usr/bin/env node
// Run the pre-push gate — the deterministic executor for the fleet push
// workflow. The LAW lives in the post-push-ci-monitor-nudge hook + the CLAUDE.md
// push bullet; this is the convenience runner that sequences the gate so a push
// is never sent on a red tree.
//
// Runs, in order (stops + fails loud on the first red step):
//   1. pnpm run update      — refresh tool/catalog pins (soak-held held)
//   2. pnpm install         — reconcile the lockfile
//   3. pnpm run fix --all   — lint/format autofix
//   4. pnpm run check --all --release — the fleet check gates, FULL tier
//      (--release opts the interactive-skipped long poles + release/network
//      checks back in, so a push is gated on the complete set, not the fast
//      interactive subset).
//   5. pnpm run cover       — full coverage suite (covers "all tests pass")
//
// On all-green it prints the next step (push + watch CI). It does NOT push —
// pushing is a deliberate act the operator does after seeing green (the
// post-push-ci-monitor-nudge then reminds to drive CI to green). Landing on
// local main is the default; this gate guards the push when you choose to.
//
// Usage: node scripts/fleet/pre-push-gate.mts

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

const logger = getDefaultLogger()

// The gate, in order. `cover` is last because it is the slowest (full suite).
export const GATE_STEPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pnpm', ['run', 'update']],
  ['pnpm', ['install']],
  ['pnpm', ['run', 'fix', '--all']],
  ['pnpm', ['run', 'check', '--all', '--release']],
  ['pnpm', ['run', 'cover']],
]

export interface GateDeps {
  runStep?:
    | ((cmd: string, args: readonly string[]) => Promise<number>)
    | undefined
}

export interface GateResult {
  ok: boolean
  // The first failing step (`pnpm run check --all`), present only when !ok.
  failed?: string | undefined
}

async function defaultRunStep(
  cmd: string,
  args: readonly string[],
): Promise<number> {
  logger.log(`[pre-push-gate] → ${cmd} ${args.join(' ')}`)
  try {
    await spawn(cmd, [...args], { stdio: 'inherit' })
    return 0
  } catch (e) {
    const code = (e as { code?: unknown | undefined } | undefined)?.code
    return typeof code === 'number' ? code : 1
  }
}

/**
 * Run the gate steps in order, stopping at the first non-zero exit. Returns
 * `{ ok: true }` only when every step passed.
 */
export async function runGate(
  deps?: GateDeps | undefined,
): Promise<GateResult> {
  const opts = {
    __proto__: null,
    runStep: defaultRunStep,
    ...deps,
  } as { [K in keyof GateDeps]-?: NonNullable<GateDeps[K]> }
  for (let i = 0, { length } = GATE_STEPS; i < length; i += 1) {
    const [cmd, args] = GATE_STEPS[i]!
    const code = await opts.runStep(cmd, args)
    if (code !== 0) {
      return { ok: false, failed: `${cmd} ${args.join(' ')}` }
    }
  }
  return { ok: true }
}

async function main(): Promise<void> {
  const result = await runGate()
  if (!result.ok) {
    logger.fail(
      `[pre-push-gate] RED at \`${result.failed}\` — fix it before pushing; nothing pushed.`,
    )
    process.exitCode = 1
    return
  }
  logger.success('[pre-push-gate] GREEN — safe to push.')
  logger.log(
    '  Next: push, then drive CI to green —\n' +
      '    git push\n' +
      '    gh run watch   # the post-push-ci-monitor-nudge reminds you',
  )
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
