/**
 * @file Soak-aware external-tools pin update lane for the fleet. The pinned
 *   build/release tools — pnpm, npm, uv, zizmor, sfw, fff, janus and the rest —
 *   live in the `external-tools.json` manifests rather than package.json, so no
 *   taze pass ever sees them. This lane is how `pnpm run update` reaches them,
 *   alongside the brew / cargo / docker / go / node lanes. The planning and
 *   rewriting is NOT reimplemented here. This lane is a thin wrapper over
 *   `../external-tools/update.mts`, the canonical updater the `external-tools`
 *   verb set also exposes directly, so ONE codepath decides what a soak-cleared
 *   release is and recomputes every integrity from downloaded bytes. Modes
 *   match every sibling lane. With `--soak-days 7` alone it dry-plans, printing
 *   the bumps it WOULD write and touching nothing; adding `--apply` writes each
 *   manifest and then re-syncs the package-manager pins. `--soak-days` is
 *   accepted for the shared lane contract and validated the same way, but the
 *   authoritative window is `minimumReleaseAge` in pnpm-workspace.yaml, the one
 *   value pnpm itself enforces. A `--soak-days` that disagrees with it is a
 *   policy split, so the lane refuses rather than silently preferring one.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { requireSoakDays } from './_shared.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { main as runExternalToolsUpdate } from '../external-tools/update.mts'
import { PNPM_WORKSPACE_YAML } from '../paths.mts'
import { readSoakRules } from '../soak-rules.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const MINUTES_PER_DAY = 1440

/**
 * The soak window `pnpm-workspace.yaml` declares, in whole days, or `undefined`
 * when the repo declares no `minimumReleaseAge` at all.
 */
export function workspaceSoakDays(yamlPath: string): number | undefined {
  const { minutes } = readSoakRules(yamlPath)
  return minutes > 0 ? minutes / MINUTES_PER_DAY : undefined
}

/**
 * Reconcile the orchestrator's `--soak-days` against the workspace's own
 * `minimumReleaseAge`. They must agree: the manifests and pnpm's installs share
 * one soak policy, so a mismatch is a real split that would let this lane adopt
 * a release pnpm would refuse (or vice versa). Returns nothing on agreement and
 * throws a What / Where / Saw / Fix error on a split. A repo with no
 * `minimumReleaseAge` has nothing to contradict, so the flag stands alone.
 */
export function assertSoakDaysAgree(
  soakDays: number,
  workspaceDays: number | undefined,
): void {
  if (workspaceDays === undefined || workspaceDays === soakDays) {
    return
  }
  throw new Error(
    'Soak window mismatch between the lane flag and the workspace policy.\n' +
      `  Where: --soak-days vs minimumReleaseAge in ${PNPM_WORKSPACE_YAML}\n` +
      `  Saw: --soak-days ${soakDays}; wanted ${workspaceDays} (minimumReleaseAge ${workspaceDays * MINUTES_PER_DAY}).\n` +
      '  Fix: pass the fleet soak window, or change minimumReleaseAge — the manifests and pnpm installs share ONE policy.',
  )
}

/**
 * CLI entry. Validates the soak contract, then delegates the whole sweep to the
 * canonical updater. Returns a process exit code.
 */
export async function main(argv: readonly string[]): Promise<number> {
  let soakDays: number
  try {
    soakDays = requireSoakDays(argv, 'update/external-tools')
    assertSoakDaysAgree(soakDays, workspaceSoakDays(PNPM_WORKSPACE_YAML))
  } catch (e) {
    logger.error(errorMessage(e))
    return 2
  }
  const apply = argv.includes('--apply')
  logger.info(
    `update/external-tools: ${apply ? 'applying' : 'planning'} soak-cleared tool pins (soak ${soakDays}d).`,
  )
  // Forward only the flags the updater owns; `--soak-days` is this lane's.
  const forwarded = apply ? ['--apply'] : []
  return await runExternalToolsUpdate(forwarded)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'advances every external-tools.json pin to its newest soak-cleared release, recomputing integrity from the downloaded bytes',
  help: `Usage: node scripts/fleet/update/external-tools.mts --soak-days <n> [flags]

  --soak-days <n>  soak window in days (must match minimumReleaseAge)
  (no mode flag)   dry plan: print the bumps it would write, touching nothing
  --apply          write every manifest, then re-sync the package-manager pins`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => main(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
