#!/usr/bin/env node
/**
 * Run the product coverage-guided fuzz tests.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from '@socketsecurity/lib-stable/process/spawn/types'

const WIN32 = process.platform === 'win32'
const cliDir = path.resolve(import.meta.dirname, '../../../..')
const repoRoot = cliDir
const binName = WIN32 ? 'vitest.cmd' : 'vitest'
// pnpm may keep vitest's bin in the package's own node_modules or hoisted at
// the workspace root — prefer the local one, fall back to the root.
const localBin = path.join(cliDir, 'node_modules', '.bin', binName)
const vitestBin = existsSync(localBin)
  ? localBin
  : path.join(repoRoot, 'node_modules', '.bin', binName)

// sync CLI runner, exits with the child's code
// oxlint-disable-next-line socket/prefer-async-spawn -- sync CLI runner
const result = spawnSync(
  vitestBin,
  [
    'run',
    '--config',
    '.config/repo/cli/vitest.config.mts',
    ...process.argv.slice(2),
  ],
  {
    __proto__: null,
    cwd: cliDir,
    env: { __proto__: null, ...process.env, VITIATE_FUZZ: '1' },
    stdio: 'inherit',
  } as unknown as SpawnSyncOptions,
) as { status?: number | null | undefined }

process.exit(result.status ?? 1)
