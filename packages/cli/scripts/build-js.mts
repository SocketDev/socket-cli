/**
 * @file Build script for CLI JavaScript bundle. Orchestrates extraction,
 *   building, and validation.
 */

import { copyFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

async function main() {
  try {
    logger.step('Building CLI bundle')
    const buildResult = await spawn(
      'node',
      ['--max-old-space-size=8192', '.config/rolldown.build.mts', 'cli'],
      { stdio: 'inherit' },
    )
    if (!buildResult) {
      logger.error('Failed to start CLI build')
      process.exitCode = 1
      return
    }
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
      ['scripts/validate-bundle.mts'],
      {
        stdio: 'inherit',
      },
    )
    if (validateResult.code !== 0) {
      process.exitCode = validateResult.code
      return
    }

    logger.success('Build completed successfully')
  } catch (e) {
    logger.error(`Build failed: ${e.message}`)
    process.exitCode = 1
  }
}

// main() catches internally and reports via process.exitCode.
void main()
