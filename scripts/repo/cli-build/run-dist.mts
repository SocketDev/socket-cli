/**
 * @file Runs the built CLI (dist/index.js), forwarding argv. Exists so the
 *   "s"/"bs" dev shortcuts have a script path that resolves before a build
 *   has ever run - check-script-paths-resolve verifies literal script paths
 *   on disk, and dist/index.js does not exist on a fresh checkout. Errors
 *   with a clear message instead of a raw ENOENT when the build is missing.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'

import type { ScriptMeta } from '../../fleet/process/run-main.mts'

const logger = getDefaultLogger()

export function main(): void {
  const distPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
    'dist',
    'index.js',
  )
  if (!existsSync(distPath)) {
    logger.error(`dist/index.js not found - run \`pnpm run build\` first.`)
    process.exitCode = 1
    return
  }
  const args = process.argv.slice(2)
  if (args[0] === '--') {
    args.shift()
  }
  const result = spawnSync(process.execPath, [distPath, ...args], {
    stdio: 'inherit',
  })
  process.exitCode = result.status ?? 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'run the built Socket CLI with forwarded arguments',
  help: 'Usage: pnpm run s [arguments]',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
