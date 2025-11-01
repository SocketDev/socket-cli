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
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

/**
 * Main entry point.
 */
async function main() {
  getDefaultLogger().log('🧹 Cleaning MiniLM Builder')
  getDefaultLogger().log('='.repeat(50))

  const buildDir = path.join(packageDir, 'build')

  if (existsSync(buildDir)) {
    getDefaultLogger().log(`\nRemoving: ${buildDir}`)
    await fs.rm(buildDir, { recursive: true, force: true })
    getDefaultLogger().log('✓ Build directory removed')
  } else {
    getDefaultLogger().log('\n✓ Nothing to clean')
  }

  getDefaultLogger().log(`\n${colors.green('✓')} Clean complete!`)
}

main().catch(error => {
  getDefaultLogger().error('\n✗ Clean failed:', error.message)
  process.exit(1)
})
