#!/usr/bin/env node
/**
 * @file `pnpm run test:fuzz` runner for the vitiate coverage-guided fuzz lane
 *   (Tier 2 of the property-and-fuzz-testing skill), scoped to this monorepo
 *   package. Runs `vitest run` with `VITIATE_FUZZ=1` from the package dir so
 *   vitest AUTO-DISCOVERS packages/cli/vitest.config.mts, which gates the
 *   `vitiatePlugin` + the `*.fuzz.ts` include ON when VITIATE_FUZZ is set. We
 *   must NOT pass `--config`: vitiate's supervisor re-spawns a child `vitest
 *   run` for the coverage-guided pass without forwarding `--config`, so parent
 *   and child agree via auto-discovery on the same package config (the child
 *   inherits VITIATE_FUZZ and gates the plugin on too). Budget via
 *   `FUZZ_TIME_MS` (default 15s). Exits with vitest's status.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from '@socketsecurity/lib-stable/process/spawn/types'

const WIN32 = process.platform === 'win32'
// packages/cli/scripts/repo/fuzz.mts → the package dir is two levels up, the
// monorepo root is four levels up.
const cliDir = path.resolve(import.meta.dirname, '..', '..')
const repoRoot = path.resolve(cliDir, '..', '..')
const binName = WIN32 ? 'vitest.cmd' : 'vitest'
// pnpm may keep vitest's bin in the package's own node_modules or hoisted at
// the workspace root — prefer the local one, fall back to the root.
const localBin = path.join(cliDir, 'node_modules', '.bin', binName)
const vitestBin = existsSync(localBin)
  ? localBin
  : path.join(repoRoot, 'node_modules', '.bin', binName)

// oxlint-disable-next-line socket/prefer-async-spawn -- sync CLI runner, exits with the child's code
const result = spawnSync(vitestBin, ['run', ...process.argv.slice(2)], {
  __proto__: null,
  cwd: cliDir,
  env: { __proto__: null, ...process.env, VITIATE_FUZZ: '1' },
  stdio: 'inherit',
} as unknown as SpawnSyncOptions) as { status?: number | null | undefined }

process.exit(result.status ?? 1)
