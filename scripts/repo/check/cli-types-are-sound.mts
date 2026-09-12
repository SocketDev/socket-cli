/**
 * @file Checks the root CLI source against its product TypeScript configuration.
 *   Usage: node scripts/repo/check/cli-types-are-sound.mts [--quiet]
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'

import type { ScriptMeta } from '../../fleet/process/run-main.mts'

const logger = getDefaultLogger()

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  // Invoke tsc through node directly (typescript is a root devDep, so the bin
  // is always linked at the repo root) — same rationale as the fleet tsc step:
  // `pnpm exec` would bury tsc's diagnostics under its own preamble.
  try {
    await spawn(
      process.execPath,
      [
        path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '-p',
        path.join(REPO_ROOT, 'tsconfig.json'),
      ],
      { cwd: REPO_ROOT, stdio: 'pipe', stdioString: true },
    )
  } catch (e) {
    // The lib spawn rejection carries the child's captured stdio.
    const stdout =
      e !== null &&
      typeof e === 'object' &&
      'stdout' in e &&
      typeof e.stdout === 'string'
        ? e.stdout
        : ''
    const stderr =
      e !== null &&
      typeof e === 'object' &&
      'stderr' in e &&
      typeof e.stderr === 'string'
        ? e.stderr
        : ''
    const output = `${stdout}${stderr}`.trim()
    logger.error(
      'CLI type checking failed in src. Expected no diagnostics. Fix the diagnostics below and run pnpm run type:cli.',
    )
    if (output) {
      logger.error(output)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success('CLI source typechecks (tsc --noEmit).')
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the root CLI source against its product TypeScript configuration',
  help: `Usage: node scripts/repo/check/cli-types-are-sound.mts [--quiet]

  --quiet  suppress the success line`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
