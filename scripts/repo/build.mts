import path from 'node:path'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../fleet/paths.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'

export async function runCliBuild(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  await spawn(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/repo/cli-build/build.mts'), ...args],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    },
  )
}

const SCRIPT_META: ScriptMeta = {
  describe: 'build the Node CLI package',
  help: `Usage: pnpm run build [--quiet] [--verbose] [--force] [--watch]`,
}

if (isMainModule(import.meta.url)) {
  runMain(runCliBuild, SCRIPT_META)
}
