/**
 * @file Fleet check step registry — assembles the full `check --all` step
 *   list from its domain-split sibling registries (hooks-and-docs, paths-
 *   and-supply-chain, release-and-docs) plus the shared `run` step executor
 *   every domain file spawns steps through. check.mts composes this with CLI
 *   scope parsing, the repo-owned check discovery loop, and the concurrent
 *   run loop.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { buildHookAndDocSteps } from './check-steps-hooks.mts'
import { buildPathsAndSupplyChainSteps } from './check-steps-paths.mts'
import { buildReleaseAndDocsSteps } from './check-steps-release.mts'

// One check's outcome: the exit-zero verdict, a short LABEL (so the parallel
// runner can name failures — concurrent output blocks can't be traced back to a
// step by position), and its FULL captured output (stdout + stderr). Output is
// CAPTURED (not inherited) so the runner prints each block atomically —
// concurrent checks would otherwise interleave their streams into noise.
export interface StepResult {
  label: string
  ok: boolean
  output: string
  // True when a release/CI-only step no-oped on the interactive tier (see
  // releaseStep). The runner tallies these into a one-line "N skipped" notice so
  // the reduced interactive coverage is never silent.
  skipped?: boolean | undefined
}

// A check step spawns its check subprocess and resolves a StepResult. Async so
// the runner can pool many concurrently — checks are READ-ONLY (enforced by
// check.mts's read-only-tree guard), so concurrent execution is race-free.
export type CheckStep = () => Promise<StepResult>

// The human label for a spawned check: the basename of the first `.mts` arg (the
// check script), else the first arg, else the command itself.
export function stepLabel(cmd: string, cmdArgs: readonly string[]): string {
  const script = cmdArgs.find(a => a.endsWith('.mts')) ?? cmdArgs[0]
  return script ? script.slice(script.lastIndexOf('/') + 1) : cmd
}

// Run `cmd cmdArgs` as a check subprocess, CAPTURING its output. Resolves
// ok:true on exit 0, ok:false otherwise — the lib `spawn` rejects on a non-zero
// exit carrying stdout/stderr, which we fold into the same shape. Never rejects:
// the runner aggregates verdicts and must not have to catch.
export async function run(cmd: string, cmdArgs: string[]): Promise<StepResult> {
  const label = stepLabel(cmd, cmdArgs)
  try {
    const r = (await spawn(cmd, cmdArgs, {
      stdio: 'pipe',
      stdioString: true,
    })) as { stderr?: string; stdout?: string }
    return { label, ok: true, output: `${r?.stdout ?? ''}${r?.stderr ?? ''}` }
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string }
    const output = `${err?.stdout ?? ''}${err?.stderr ?? ''}`
    return { label, ok: false, output: output || errorMessage(e) || String(e) }
  }
}

// A release/CI-only step. On the interactive tier (FLEET_CHECK_RELEASE unset) it
// no-ops instantly — marked `skipped` so the runner tallies a one-line notice —
// so the wall-clock long poles (bundle round-trip, npm/pnpm pack, network
// audits) stay out of a dev's inner loop. The runner sets FLEET_CHECK_RELEASE
// when invoked with --release or under CI, and pre-push-gate + CI both do, so
// the full set is always enforced before a push/merge.
export function releaseStep(cmdArgs: string[]): CheckStep {
  return () =>
    process.env['FLEET_CHECK_RELEASE']
      ? run('node', cmdArgs)
      : Promise.resolve({
          label: stepLabel('node', cmdArgs),
          ok: true,
          output: '',
          skipped: true,
        })
}

export function buildSteps(forwardedArgs: string[]): CheckStep[] {
  return [
    ...buildHookAndDocSteps(forwardedArgs),
    ...buildPathsAndSupplyChainSteps(),
    ...buildReleaseAndDocsSteps(),
  ]
}
