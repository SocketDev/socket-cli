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

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

function main(): void {
  const distPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dist',
    'index.js',
  )
  if (!existsSync(distPath)) {
    process.stderr.write(
      `dist/index.js not found - run \`pnpm run build\` first.\n`,
    )
    process.exitCode = 1
    return
  }
  const result = spawnSync(
    process.execPath,
    [distPath, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
    },
  )
  process.exitCode = result.status ?? 1
}

main()
