/**
 * Unified SEA test script with multiple execution modes. Consolidates
 * test-sea-standalone, test-sea-vfs, and test-sea-with-tools.
 *
 * Usage: node scripts/test-sea.mts --mode=standalone node scripts/test-sea.mts
 * --mode=vfs node scripts/test-sea.mts --mode=with-tools.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runStandaloneMode } from './test-sea-mode-standalone.mts'
import { runVfsMode } from './test-sea-mode-vfs.mts'
import { runWithToolsMode } from './test-sea-mode-with-tools.mts'
import { loadToolPaths, parseArgs } from './test-sea-shared.mts'

const logger = getDefaultLogger()

/**
 * Test the generated binary.
 */
async function testBinary(outputPath) {
  logger.log('Testing binary…')
  logger.log('-'.repeat(60))
  const testResult = await spawn(outputPath, [], { stdio: 'inherit' })
  logger.log('-'.repeat(60))

  if (testResult.code === 0) {
    logger.success('Binary works!')
  } else {
    logger.fail('Binary test failed')
    process.exitCode = 1
  }
}

/**
 * Main function.
 */
async function main() {
  const { mode } = parseArgs()

  let outputPath

  if (mode === 'vfs') {
    // VFS mode doesn't need tool paths (uses external tar.gz).
    const { platform } = await loadToolPaths()
    outputPath = await runVfsMode(platform)
  } else {
    // Other modes need tool paths.
    const { platform, toolPaths } = await loadToolPaths()

    if (mode === 'standalone') {
      outputPath = await runStandaloneMode(platform, toolPaths)
    } else if (mode === 'with-tools') {
      outputPath = await runWithToolsMode(platform, toolPaths)
    }
  }

  await testBinary(outputPath)
}

main().catch(e => {
  logger.fail(e)
  process.exitCode = 1
})
