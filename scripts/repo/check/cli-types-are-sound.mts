/**
 * @file Repo check — the `packages/cli` source tree typechecks. The fleet
 *   check runner's tsc step covers only the script-tree tsconfig
 *   (`.config/fleet/tsconfig.check.json`), so without this gate a type error
 *   in `packages/cli/src` rides along silently until a build or an editor
 *   surfaces it. Runs `tsc --noEmit -p packages/cli/tsconfig.json` (the same
 *   config `pnpm --filter @socketsecurity/cli run type` uses) and fails with
 *   the diagnostics when the tree does not compile.
 *   Usage: node scripts/repo/check/cli-types-are-sound.mts [--quiet]
 */

import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  // Invoke tsc through node directly (typescript is a root devDep, so the bin
  // is always linked at the repo root) — same rationale as the fleet tsc step:
  // `pnpm exec` would bury tsc's diagnostics under its own preamble.
  try {
    await spawn(
      'node',
      [
        path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '-p',
        path.join(REPO_ROOT, 'packages', 'cli', 'tsconfig.json'),
      ],
      { cwd: REPO_ROOT, stdio: 'pipe', stdioString: true },
    )
  } catch (e) {
    // The lib spawn rejection carries the child's captured stdio.
    const stdout =
      e &&
      typeof e === 'object' &&
      'stdout' in e &&
      typeof e.stdout === 'string'
        ? e.stdout
        : ''
    const stderr =
      e &&
      typeof e === 'object' &&
      'stderr' in e &&
      typeof e.stderr === 'string'
        ? e.stderr
        : ''
    const output = `${stdout}${stderr}`.trim()
    logger.error(
      'packages/cli does not typecheck — fix the tsc diagnostics below (repro: node node_modules/typescript/bin/tsc --noEmit -p packages/cli/tsconfig.json):',
    )
    if (output) {
      logger.error(output)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success('packages/cli typechecks (tsc --noEmit).')
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
