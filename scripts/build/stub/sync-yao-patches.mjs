
/**
 * @fileoverview Sync yao-pkg patches with caching
 *
 * This script checks and downloads yao-pkg patches with TTL-based caching
 * to avoid unnecessary downloads during builds.
 */

import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PATCHES_DIR = join(__dirname, 'patches')
const YAO_PATCHES_DIR = join(PATCHES_DIR, 'yao')
const CACHE_FILE = join(YAO_PATCHES_DIR, '.sync-cache.json')
const DEFAULT_TTL = 24 * 60 * 60 * 1000 // 24 hours in milliseconds

/**
 * Check if patches need updating based on TTL
 */
async function needsUpdate(ttl = DEFAULT_TTL) {
  if (!existsSync(CACHE_FILE)) {
    return true
  }

  try {
    const cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'))
    const lastSync = new Date(cache.lastSync).getTime()
    const now = Date.now()

    if (now - lastSync > ttl) {
      return true
    }

    // Check if patches directory has expected files
    const patchesJson = join(YAO_PATCHES_DIR, 'patches.json')
    if (!existsSync(patchesJson)) {
      return true
    }

    return false
  } catch {
    return true
  }
}

/**
 * Update cache timestamp
 */
async function updateCache(versions = []) {
  const cache = {
    lastSync: new Date().toISOString(),
    versions,
    source: 'https://github.com/yao-pkg/pkg-fetch/tree/main/patches'
  }

  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
}

/**
 * Sync yao-pkg patches
 */
export async function syncYaoPatches(options = {}) {
  const {
    force = false,
    quiet = false,
    ttl = DEFAULT_TTL,
    versions = ['v24.9.0', 'v22.19.0', 'v20.19.5']
  } = options

  // Check if update is needed
  if (!force && !(await needsUpdate(ttl))) {
    if (!quiet) {
      console.log('✅ Yao patches are up to date (cached)')
    }
    return 0
  }

  if (!quiet) {
    console.log('🔄 Syncing yao-pkg patches...')
  }

  try {
    // Import and use the fetch-patches module
    const { fetchPatches } = await import('./fetch-patches.mjs')

    await fetchPatches({ versions })
    await updateCache(versions)

    if (!quiet) {
      console.log('✅ Yao patches synced successfully')
    }
    return 0
  } catch (error) {
    if (!quiet) {
      console.error(`❌ Failed to sync patches: ${error.message}`)
    }
    return 1
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    force: false,
    ttl: DEFAULT_TTL,
    quiet: false,
    help: false
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--quiet') {
      options.quiet = true
    } else if (arg.startsWith('--ttl=')) {
      const hours = parseInt(arg.split('=')[1], 10)
      options.ttl = hours * 60 * 60 * 1000
    }
  }

  return options
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Yao Patches Sync
=================

Usage: node scripts/build/stub/sync-yao-patches.mjs [options]

Options:
  --force      Force re-download even if cached
  --ttl=HOURS  Cache time-to-live in hours (default: 24)
  --quiet      Suppress output
  --help, -h   Show this help

Examples:
  # Check and sync if needed (24h TTL)
  node scripts/build/stub/sync-yao-patches.mjs

  # Force sync
  node scripts/build/stub/sync-yao-patches.mjs --force

  # Use 1-hour TTL
  node scripts/build/stub/sync-yao-patches.mjs --ttl=1

This script is automatically called during builds to ensure
yao-pkg patches are up to date.
`)
}

// Main
async function main() {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  const exitCode = await syncYaoPatches(options)
  process.exit(exitCode)
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

export default syncYaoPatches