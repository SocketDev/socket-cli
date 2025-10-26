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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

/**
 * Main entry point.
 */
async function main() {
  console.log('🧹 Cleaning MiniLM Builder')
  console.log('='.repeat(50))

  const buildDir = path.join(packageDir, 'build')

  if (existsSync(buildDir)) {
    console.log(`\nRemoving: ${buildDir}`)
    await fs.rm(buildDir, { recursive: true, force: true })
    console.log('✓ Build directory removed')
  } else {
    console.log('\n✓ Nothing to clean')
  }

  console.log('\n✅ Clean complete!')
}

main().catch(error => {
  console.error('\n✗ Clean failed:', error.message)
  process.exit(1)
})
