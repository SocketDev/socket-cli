#!/usr/bin/env node
/**
 * Clean stale caches across all packages.
 *
 * Usage:
 *   pnpm run clean:cache         # Clean all stale caches
 *   pnpm run clean:cache --all   # Clean ALL caches (nuclear option)
 *   pnpm run clean:cache --dry-run # Show what would be deleted
 */

import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT_DIR = join(__dirname, '..')

const { values } = parseArgs({
  options: {
    all: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
  },
  strict: false,
})

const dryRun = values['dry-run']
const cleanAll = values.all

/**
 * Find all .cache directories in packages.
 */
function findCacheDirs() {
  const cacheDirs = []
  const packagesDir = join(ROOT_DIR, 'packages')

  try {
    const packages = readdirSync(packagesDir)
    for (const pkg of packages) {
      const cacheDir = join(packagesDir, pkg, '.cache')
      try {
        statSync(cacheDir)
        cacheDirs.push({ package: pkg, path: cacheDir })
      } catch {
        // No cache dir, skip.
      }
    }
  } catch (error) {
    console.error(`Error scanning packages: ${error.message}`)
  }

  return cacheDirs
}

/**
 * Analyze cache directory and determine what to clean.
 */
function analyzeCacheDir(cacheDir) {
  const entries = []

  try {
    const items = readdirSync(cacheDir)
    for (const item of items) {
      const itemPath = join(cacheDir, item)
      const stats = statSync(itemPath)

      if (stats.isDirectory()) {
        entries.push({
          name: item,
          path: itemPath,
          size: getDirSize(itemPath),
          mtime: stats.mtime,
          ageD: Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)),
        })
      }
    }
  } catch (error) {
    console.error(`Error analyzing ${cacheDir}: ${error.message}`)
  }

  return entries.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Get directory size recursively.
 */
function getDirSize(dir) {
  let size = 0
  try {
    const items = readdirSync(dir)
    for (const item of items) {
      const itemPath = join(dir, item)
      const stats = statSync(itemPath)
      if (stats.isDirectory()) {
        size += getDirSize(itemPath)
      } else {
        size += stats.size
      }
    }
  } catch {
    // Ignore errors.
  }
  return size
}

/**
 * Format bytes to human readable.
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const cacheDirs = findCacheDirs()

if (!cacheDirs.length) {
  console.log('No cache directories found.')
  process.exit(0)
}

console.log(`Found ${cacheDirs.length} cache director${cacheDirs.length === 1 ? 'y' : 'ies'}:\n`)

let totalDeleted = 0
let totalSize = 0

for (const { package: pkg, path: cacheDir } of cacheDirs) {
  const entries = analyzeCacheDir(cacheDir)

  if (!entries.length) {
    console.log(`📦 ${pkg}: Empty cache`)
    continue
  }

  console.log(`📦 ${pkg}:`)

  if (cleanAll) {
    // Delete everything.
    for (const entry of entries) {
      console.log(`  ${dryRun ? '[DRY RUN]' : '✗'} ${entry.name} (${formatSize(entry.size)}, ${entry.ageD}d old)`)
      if (!dryRun) {
        rmSync(entry.path, { recursive: true, force: true })
      }
      totalDeleted++
      totalSize += entry.size
    }
  } else {
    // Keep most recent, delete older ones.
    const [latest, ...older] = entries

    console.log(`  ✓ ${latest.name} (${formatSize(latest.size)}, ${latest.ageD}d old) - KEEP`)

    for (const entry of older) {
      console.log(`  ${dryRun ? '[DRY RUN]' : '✗'} ${entry.name} (${formatSize(entry.size)}, ${entry.ageD}d old)`)
      if (!dryRun) {
        rmSync(entry.path, { recursive: true, force: true })
      }
      totalDeleted++
      totalSize += entry.size
    }
  }

  console.log('')
}

if (totalDeleted > 0) {
  console.log(
    `${dryRun ? 'Would delete' : 'Deleted'} ${totalDeleted} cache entr${totalDeleted === 1 ? 'y' : 'ies'} (${formatSize(totalSize)})`,
  )
} else {
  console.log('✓ All caches are current - nothing to delete')
}

if (dryRun) {
  console.log('\nRun without --dry-run to actually delete.')
}
