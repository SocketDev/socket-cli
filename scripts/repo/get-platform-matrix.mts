#!/usr/bin/env node
/**
 * Output platform matrix JSON for GitHub Actions. Used by publish workflow to
 * generate dynamic matrix.
 *
 * Usage: node scripts/get-platform-matrix.mts.
 *
 * # Outputs: {"include":[...]}
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PLATFORM_CONFIGS } from '../../packages/build-infra/lib/platform-targets.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

import type { ScriptMeta } from '../fleet/process/run-main.mts'

const logger = getDefaultLogger()

interface MatrixEntry {
  arch: string
  libc: string | undefined
  platform: string
  releasePlatform: string
  runner: string
}

export const matrix: { include: MatrixEntry[] } = {
  include: PLATFORM_CONFIGS.map((c): MatrixEntry => ({
    arch: c.arch,
    libc: c.libc ?? undefined,
    platform: c.platform, // Node.js platform (win32 for Windows)
    releasePlatform: c.releasePlatform, // Release naming, win for Windows
    runner: c.runner,
  })),
}

export function main(): void {
  logger.log(JSON.stringify(matrix))
}

const SCRIPT_META: ScriptMeta = {
  describe: 'print the GitHub Actions platform matrix as JSON',
  help: 'Usage: node scripts/repo/get-platform-matrix.mts [--json]',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
