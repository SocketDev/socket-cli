/**
 * @fileoverview Build script for CLI JavaScript bundle.
 * Orchestrates extraction, building, and validation.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

async function main() {
  try {
    // Step 1: Extract yoga WASM.
    logger.step('Extracting yoga WASM')
    const extractResult = await spawn(
      'node',
      ['--max-old-space-size=8192', 'scripts/extract-yoga-wasm.mjs'],
      { stdio: 'inherit' },
    )
    if (extractResult.code !== 0) {
      process.exitCode = extractResult.code
      return
    }

    // Step 2: Build with esbuild.
    logger.step('Building CLI bundle')
    const buildResult = await spawn(
      'node',
      ['--max-old-space-size=8192', '.config/esbuild.cli.build.mjs'],
      { stdio: 'inherit' },
    )
    if (buildResult.code !== 0) {
      process.exitCode = buildResult.code
      return
    }

    // Step 3: Validate bundle.
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
