#!/usr/bin/env node
/**
 * Output platform matrix JSON for GitHub Actions.
 * Used by publish workflow to generate dynamic matrix.
 *
 * Usage:
 *   node scripts/get-platform-matrix.mjs
 *   # Outputs: {"include":[...]}
 */

import { PLATFORM_CONFIGS } from '../packages/build-infra/lib/platform-targets.mjs'

const matrix = {
  include: PLATFORM_CONFIGS.map(c => ({
    arch: c.arch,
    libc: c.libc ?? null,
    platform: c.platform, // Node.js platform (win32 for Windows)
    releasePlatform: c.releasePlatform, // Release naming (win for Windows)
    runner: c.runner,
  })),
}

console.log(JSON.stringify(matrix))
