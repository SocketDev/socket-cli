/**
 * @fileoverview Restore build artifacts from GitHub Actions cache.
 * This is a nice-to-have optimization that speeds up first build after clone.
 *
 * Usage:
 *   node scripts/restore-cache.mjs [options]
 *
 * Options:
 *   --quiet      Suppress progress output.
 *   --verbose    Show detailed output.
 *
 * Requirements:
 *   - gh CLI must be installed (https://cli.github.com/).
 *   - Must be in a git repository.
 *   - Must have network access to GitHub.
 *
 * Behavior:
 *   - Checks if build artifacts already exist (skip if present).
 *   - Computes cache key for current commit.
 *   - Attempts to download matching cache from GitHub Actions.
 *   - Silently fails if cache not available (no harm, no foul).
 *   - Extracts cache to packages/cli/build/ and packages/cli/dist/.
 */

import { existsSync, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(__dirname, '../../..')

const isQuiet = () => process.argv.includes('--quiet')
const isVerbose = () => process.argv.includes('--verbose')

/**
 * Check if gh CLI is available.
 */
async function hasGhCli() {
  try {
    const result = await spawn('gh', ['--version'], {
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Get current git commit SHA.
 */
async function getCurrentCommit() {
  try {
    const result = await spawn('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      stdio: 'pipe',
    })
    if (result.code !== 0) {
      return null
    }
    return result.stdout.trim()
  } catch {
    return null
  }
}

/**
 * Compute hash of file.
 */
async function hashFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return createHash('sha256').update(content).digest('hex')
  } catch {
    return 'none'
  }
}

/**
 * Compute hash of all files matching glob pattern.
 */
async function hashFiles(globPattern, cwd) {
  try {
    const result = await spawn(
      'find',
      globPattern
        .split(' ')
        .concat([
          '-type',
          'f',
          '!',
          '-path',
          '*/node_modules/*',
          '!',
          '-path',
          '*/dist/*',
          '!',
          '-path',
          '*/build/*',
        ]),
      {
        cwd,
        stdio: 'pipe',
      },
    )
    if (result.code !== 0) {
      return 'none'
    }
    const files = result.stdout.split('\n').filter(Boolean).sort()
    if (!files.length) {
      return 'none'
    }
    const hash = createHash('sha256')
    for (const file of files) {
      const content = await fs.readFile(path.join(cwd, file), 'utf8')
      hash.update(content)
    }
    return hash.digest('hex')
  } catch {
    return 'none'
  }
}

/**
 * Generate CLI build cache key (matches CI workflow).
 */
async function generateCacheKey() {
  const pnpmLockHash = await hashFile(path.join(repoRoot, 'pnpm-lock.yaml'))
  const srcHash = await hashFiles('packages/cli/src', repoRoot)
  const configHash = await hashFiles(
    'packages/cli/.config packages/cli/scripts',
    repoRoot,
  )
  const combined = `${pnpmLockHash}-${srcHash}-${configHash}`
  return createHash('sha256').update(combined).digest('hex')
}

/**
 * Check if cache exists in GitHub Actions.
 */
async function cacheExists(repo, cacheKey) {
  try {
    const result = await spawn(
      'gh',
      [
        'cache',
        'list',
        '--repo',
        repo,
        '--key',
        `cli-build-Linux-${cacheKey}`,
        '--json',
        'key',
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    )
    if (result.code !== 0) {
      return false
    }
    const caches = JSON.parse(result.stdout)
    return Array.isArray(caches) && caches.length > 0
  } catch {
    return false
  }
}

/**
 * Download and extract cache from GitHub Actions.
 */
async function restoreCache(repo, cacheKey) {
  const tempDir = path.join(packageRoot, '.cache', 'restore')
  await fs.mkdir(tempDir, { recursive: true })

  try {
    // Note: gh cache download is not yet available.
    // We'll use the gh actions cache download API instead.
    logger.info('Downloading cache from GitHub Actions...')

    // For now, we use gh api to download the cache.
    const result = await spawn(
      'gh',
      [
        'api',
        `/repos/${repo}/actions/cache`,
        '-H',
        'Accept: application/vnd.github+json',
        '--jq',
        `.actions_caches[] | select(.key == "cli-build-Linux-${cacheKey}") | .id`,
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    )

    if (result.code !== 0 || !result.stdout.trim()) {
      logger.warn('Cache ID not found.')
      return false
    }

    const cacheId = result.stdout.trim()

    // Download cache archive.
    const downloadResult = await spawn(
      'gh',
      [
        'api',
        `/repos/${repo}/actions/caches/${cacheId}/download`,
        '-H',
        'Accept: application/octet-stream',
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    )

    if (downloadResult.code !== 0) {
      logger.warn('Failed to download cache archive.')
      return false
    }

    // Extract cache (GitHub Actions uses tar + zstd).
    const cacheArchive = path.join(tempDir, 'cache.tar.zst')
    await fs.writeFile(
      cacheArchive,
      Buffer.from(downloadResult.stdout, 'binary'),
    )

    // Extract with tar.
    const extractResult = await spawn(
      'tar',
      ['-xf', cacheArchive, '-C', packageRoot],
      {
        cwd: tempDir,
        stdio: 'pipe',
      },
    )

    if (extractResult.code !== 0) {
      logger.warn('Failed to extract cache archive.')
      return false
    }

    logger.success('Cache restored successfully!')
    return true
  } catch (error) {
    if (isVerbose()) {
      logger.error(`Cache restoration failed: ${error.message}`)
    }
    return false
  } finally {
    // Clean up temp directory.
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

/**
 * Main entry point.
 */
async function main() {
  if (!isQuiet()) {
    logger.log('')
    logger.log('CLI Build Cache Restoration')
    logger.log('===========================')
    logger.log('')
  }

  // Check if build artifacts already exist.
  const buildDir = path.join(packageRoot, 'build')
  const distDir = path.join(packageRoot, 'dist')

  if (existsSync(buildDir) && existsSync(distDir)) {
    if (!isQuiet()) {
      logger.info('Build artifacts already exist, skipping cache restoration.')
    }
    return 0
  }

  // Check if gh CLI is available.
  if (!(await hasGhCli())) {
    if (!isQuiet()) {
      logger.info('gh CLI not found (optional dependency).')
      logger.info('Install from: https://cli.github.com/')
    }
    return 0
  }

  // Get current commit.
  const commit = await getCurrentCommit()
  if (!commit) {
    if (!isQuiet()) {
      logger.info('Not in a git repository, skipping cache restoration.')
    }
    return 0
  }

  if (!isQuiet()) {
    logger.step(`Current commit: ${commit.slice(0, 8)}`)
  }

  // Generate cache key.
  const cacheKey = await generateCacheKey()
  if (!isQuiet()) {
    logger.step(`Cache key: cli-build-Linux-${cacheKey.slice(0, 16)}...`)
  }

  // Get repository name.
  const repoResult = await spawn(
    'git',
    ['config', '--get', 'remote.origin.url'],
    {
      cwd: repoRoot,
      stdio: 'pipe',
    },
  )
  if (repoResult.code !== 0) {
    if (!isQuiet()) {
      logger.info('Could not determine repository, skipping cache restoration.')
    }
    return 0
  }

  const repoUrl = repoResult.stdout.trim()
  const repoMatch = repoUrl.match(/github\.com[/:](.+?)(?:\.git)?$/)
  if (!repoMatch) {
    if (!isQuiet()) {
      logger.info('Not a GitHub repository, skipping cache restoration.')
    }
    return 0
  }

  const repo = repoMatch[1]
  if (!isQuiet()) {
    logger.step(`Repository: ${repo}`)
  }

  // Check if cache exists.
  if (!isQuiet()) {
    logger.step('Checking if cache exists...')
  }

  if (!(await cacheExists(repo, cacheKey))) {
    if (!isQuiet()) {
      logger.info('Cache not found for this commit.')
      logger.info('This is normal for first-time builds or new commits.')
    }
    return 0
  }

  // Restore cache.
  if (!isQuiet()) {
    logger.step('Restoring cache...')
  }

  const success = await restoreCache(repo, cacheKey)
  if (!success) {
    if (!isQuiet()) {
      logger.warn('Cache restoration failed, will build from scratch.')
    }
    return 0
  }

  if (!isQuiet()) {
    logger.log('')
    logger.success('Build cache restored! Builds will be much faster.')
    logger.log('')
  }

  return 0
}

main()
  .then(code => {
    process.exit(code)
  })
  .catch(error => {
    logger.error(error.message)
    if (isVerbose()) {
      logger.error(error.stack)
    }
    process.exit(1)
  })
