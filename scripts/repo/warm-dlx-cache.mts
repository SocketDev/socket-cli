/**
 * @file Warms the Socket dlx cache for external tools the test suite really
 *   executes, so cold-cache CI runners pay the download BEFORE vitest fans
 *   out. The `socket manifest cdxgen --help` integration tests run a REAL
 *   cdxgen through Socket dlx; a cold cache means an in-process Arborist
 *   install of @cyclonedx/cdxgen and its full dependency tree, which cannot
 *   finish inside a per-test budget while every CPU is busy running the rest
 *   of the suite. Running the same command here, serially on an idle machine,
 *   matches the download's real cost (~40-120s cold, ~1s warm) and keeps the
 *   tests measuring CLI behavior instead of npm download throughput.
 *   Best-effort by design: a missing CLI build or a failed download only
 *   warns — the suite still runs and reports its own failures. Usage: node
 *   scripts/repo/warm-dlx-cache.mts (wired into the root `pretest` script).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const repoRoot = path.join(fileURLToPath(import.meta.url), '..', '..', '..')
const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js')

// Bounded so a wedged registry can never hang the suite start; generous
// because a cold @cyclonedx/cdxgen install is a full dependency-tree
// download.
const WARM_TIMEOUT_MS = 600_000

async function main(): Promise<void> {
  if (!existsSync(cliPath)) {
    logger.warn(
      `dlx warm-up skipped: CLI not built at ${cliPath} (run \`pnpm run build:cli\` first)`,
    )
    return
  }
  const start = Date.now()
  try {
    await spawn(
      process.execPath,
      [cliPath, 'manifest', 'cdxgen', '--help', '--config', '{}'],
      {
        stdio: 'ignore',
        timeout: WARM_TIMEOUT_MS,
      },
    )
    logger.info(
      `dlx cache warm for cdxgen in ${Math.round((Date.now() - start) / 1000)}s`,
    )
  } catch (e) {
    logger.warn(
      `dlx warm-up for cdxgen did not complete (${errorMessage(e)}); tests that spawn cdxgen may pay the download themselves`,
    )
  }
}

void main()
