import { existsSync } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { gitSync } from '../fleet/git/exec.mts'
import { parseCleanArgs, resolveCleanPlan, runClean } from '../fleet/clean.mts'
import { REPO_ROOT } from '../fleet/paths.mts'
import { getScriptArgs } from '../fleet/process/script-output.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

import type { ScriptMeta } from '../fleet/process/run-main.mts'

const logger = getDefaultLogger()
const OBSOLETE_PACKAGES_DIR = path.join(REPO_ROOT, 'packages')

export function trackedObsoletePackageFiles(repoRoot = REPO_ROOT): string[] {
  const result = gitSync(['ls-files', '--', 'packages'], { cwd: repoRoot })
  return String(result.stdout).split(/\r?\n/).filter(Boolean)
}

export async function cleanSocketCli(
  options: {
    dryRun?: boolean | undefined
    fleetArgs?: readonly string[] | undefined
  } = {},
): Promise<void> {
  const { dryRun = false, fleetArgs = [] } = options
  const tracked = trackedObsoletePackageFiles()
  if (tracked.length) {
    throw new Error(
      `Obsolete packages cleanup refused. Where: ${OBSOLETE_PACKAGES_DIR}. Saw: ${tracked.length} tracked file(s); wanted an untracked flattened-layout residue. Fix: move tracked source into src/ or scripts/repo/ before cleaning.`,
    )
  }
  const fleetOptions = parseCleanArgs(fleetArgs).options
  const plan = resolveCleanPlan(REPO_ROOT, fleetOptions)
  if (dryRun) {
    if (existsSync(OBSOLETE_PACKAGES_DIR)) {
      logger.log(`Would remove ${OBSOLETE_PACKAGES_DIR}`)
    }
    return
  }
  await runClean(plan)
  if (existsSync(OBSOLETE_PACKAGES_DIR)) {
    await safeDelete(OBSOLETE_PACKAGES_DIR, {
      allowedDirs: [REPO_ROOT],
      recursive: true,
    })
  }
}

async function main(): Promise<void> {
  const args = getScriptArgs()
  await cleanSocketCli({
    dryRun: args.includes('--dry-run'),
    fleetArgs: args,
  })
}

const SCRIPT_META: ScriptMeta = {
  describe: 'removes Socket CLI build output and obsolete package-tree residue',
  help: 'Usage: pnpm run clean [--dry-run] [--cache] [--node-modules] [--all]',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
