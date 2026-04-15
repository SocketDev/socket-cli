/**
 * Clean stale caches across all packages.
 *
 * Usage:
 *   pnpm run clean:cache         # Clean all stale caches
 *   pnpm run clean:cache --all   # Clean ALL caches (nuclear option)
 *   pnpm run clean:cache --dry-run # Show what would be deleted
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getGlobalCacheDirs } from '../packages/cli/scripts/constants/paths.mjs'

const logger = getDefaultLogger()

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

interface CacheDirInfo {
  package: string
  path: string
}

interface CacheEntry {
  name: string
  path: string
  size: number
  mtime: Date
  ageD: number
}

/**
 * Find all .cache directories in packages.
 */
function findCacheDirs(): CacheDirInfo[] {
  const cacheDirs: CacheDirInfo[] = []
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Error scanning packages: ${message}`)
  }

  return cacheDirs
}

/**
 * Analyze cache directory and determine what to clean.
 */
function analyzeCacheDir(cacheDir: string): CacheEntry[] {
  const entries: CacheEntry[] = []

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
          ageD: Math.floor(
            (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24),
          ),
        })
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Error analyzing ${cacheDir}: ${message}`)
  }

  return entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
}

/**
 * Get directory size recursively.
 */
function getDirSize(dir: string): number {
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
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function main(): Promise<void> {
  const cacheDirs = findCacheDirs()

  if (!cacheDirs.length) {
    logger.log('No cache directories found.')
    return
  }

  logger.log(
    `Found ${cacheDirs.length} cache director${cacheDirs.length === 1 ? 'y' : 'ies'}:\n`,
  )

  let totalDeleted = 0
  let totalSize = 0

  for (const { package: pkg, path: cacheDir } of cacheDirs) {
    const entries = analyzeCacheDir(cacheDir)

    if (!entries.length) {
      logger.log(`📦 ${pkg}: Empty cache`)
      continue
    }

    logger.log(`📦 ${pkg}:`)

    if (cleanAll) {
      // Delete everything.
      for (const entry of entries) {
        logger.log(
          `  ${dryRun ? '[DRY RUN]' : '✗'} ${entry.name} (${formatSize(entry.size)}, ${entry.ageD}d old)`,
        )
        if (!dryRun) {
          // eslint-disable-next-line no-await-in-loop
          await safeDelete(entry.path)
        }
        totalDeleted++
        totalSize += entry.size
      }
    } else {
      // Keep most recent, delete older ones.
      const [latest, ...older] = entries

      logger.log(
        `  ✓ ${latest.name} (${formatSize(latest.size)}, ${latest.ageD}d old) - KEEP`,
      )

      for (const entry of older) {
        logger.log(
          `  ${dryRun ? '[DRY RUN]' : '✗'} ${entry.name} (${formatSize(entry.size)}, ${entry.ageD}d old)`,
        )
        if (!dryRun) {
          // eslint-disable-next-line no-await-in-loop
          await safeDelete(entry.path)
        }
        totalDeleted++
        totalSize += entry.size
      }
    }

    logger.log('')
  }

  if (totalDeleted > 0) {
    logger.log(
      `${dryRun ? 'Would delete' : 'Deleted'} ${totalDeleted} cache entr${totalDeleted === 1 ? 'y' : 'ies'} (${formatSize(totalSize)})`,
    )
  } else {
    logger.log('✓ All caches are current - nothing to delete')
  }

  // Clean global caches if --all flag is used.
  if (cleanAll) {
    logger.log('')
    logger.log('🌍 Cleaning global caches:')

    const globalCaches = getGlobalCacheDirs()

    for (const { name, path } of globalCaches) {
      try {
        const stats = statSync(path)
        const size = stats.isDirectory() ? getDirSize(path) : stats.size
        logger.log(
          `  ${dryRun ? '[DRY RUN]' : '✗'} ${name} (${formatSize(size)})`,
        )
        if (!dryRun) {
          // eslint-disable-next-line no-await-in-loop
          await safeDelete(path)
        }
      } catch {
        // Cache doesn't exist, skip.
      }
    }
  }

  if (dryRun) {
    logger.log('\nRun without --dry-run to actually delete.')
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  logger.error(`Error: ${message}`)
  process.exitCode = 1
})
