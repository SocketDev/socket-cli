/**
 * @fileoverview Build script for CLI JavaScript bundle.
 * Orchestrates extraction, building, and validation.
 */

import { copyFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

async function main() {
  try {
    // Step 1: Download yoga WASM.
    logger.step('Downloading yoga WASM')
    const extractResult = await spawn(
      'node',
      ['--max-old-space-size=8192', 'scripts/download-assets.mjs', 'yoga'],
      { stdio: 'inherit' },
    )

    if (!extractResult) {
      logger.error('Failed to start asset download')
      process.exitCode = 1
      return
    }

    if (extractResult.code !== 0) {
      process.exitCode = extractResult.code
      return
    }

    // Step 2: Build with esbuild.
    logger.step('Building CLI bundle')
    const buildResult = await spawn(
      'node',
      ['--max-old-space-size=8192', '.config/esbuild.config.mjs', 'cli'],
      { stdio: 'inherit' },
    )
    if (buildResult.code !== 0) {
      process.exitCode = buildResult.code
      return
    }

    // Step 3: Copy bundle to dist/.
    copyFileSync('build/cli.js', 'dist/cli.js')

    // Step 4: Validate bundle.
    logger.step('Validating bundle')
    const validateResult = await spawn(
      'node',
      ['scripts/validate-bundle.mjs'],
      { stdio: 'inherit' },
    )
    if (validateResult.code !== 0) {
      process.exitCode = validateResult.code
      return
    }

    logger.success('Build completed successfully')
  } catch (error) {
    logger.error(`Build failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
