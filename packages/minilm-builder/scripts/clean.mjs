#!/usr/bin/env node
/**
 * MiniLM Model Builder Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

/**
 * Main entry point.
 */
async function main() {
  logger.log('🧹 Cleaning MiniLM Builder')
  logger.log('='.repeat(50))

  const buildDir = path.join(packageDir, 'build')

  if (existsSync(buildDir)) {
    logger.log(`\nRemoving: ${buildDir}`)
    await fs.rm(buildDir, { recursive: true, force: true })
    logger.log('✓ Build directory removed')
  } else {
    logger.log('\n✓ Nothing to clean')
  }

  logger.log(`\n${colors.green('✓')} Clean complete!`)
}

main().catch(error => {
  logger.error('\n✗ Clean failed:', error.message)
  process.exit(1)
})
