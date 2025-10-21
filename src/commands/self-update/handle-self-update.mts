/**
 * Handle self-update command logic.
 *
 * This implements the actual self-update functionality using the sfw-installer
 * pattern of downloading and replacing binaries with rollback capabilities.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { getIpcStubPath } from '@socketsecurity/lib/ipc'
import { logger } from '@socketsecurity/lib/logger'

import { outputSelfUpdate } from './output-self-update.mts'
import ENV from '../../constants/env.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { isSeaBinary } from '../../utils/executable/detect.mjs'
import {
  clearQuarantine,
  ensureExecutable,
  getExpectedAssetName,
} from '../../utils/process/os.mjs'

import type { CliCommandConfig } from '../../utils/cli/with-subcommands.mjs'

// Helper functions for updater paths.
function getSocketCliUpdaterDownloadsDir(): string {
  return path.join(os.tmpdir(), 'socket-cli-updater', 'downloads')
}

function getSocketCliUpdaterStagingDir(): string {
  return path.join(os.tmpdir(), 'socket-cli-updater', 'staging')
}

// Helper function for removing files.
async function remove(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { recursive: true, force: true })
  } catch {
    // Ignore errors.
  }
}

/**
 * GitHub release asset information.
 */
interface ReleaseAsset {
  name: string
  browser_download_url: string
  content_type: string
  size: number
}

/**
 * Parse checksums file content.
 * Supports formats like "hash filename" or "hash  filename".
 */
function parseChecksumsFile(content: string): Map<string, string> {
  const checksums = new Map<string, string>()
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Match: hash  filename or hash filename.
    const match = /^([a-f0-9]{64})\s+(.+)$/i.exec(trimmed)
    if (match) {
      const hash = match[1]
      const filename = match[2]
      if (hash && filename) {
        checksums.set(filename, hash.toLowerCase())
      }
    }
  }

  return checksums
}

/**
 * Fetch checksums for a release.
 * Looks for common checksum file names in release assets.
 */
async function fetchReleaseChecksums(
  release: GitHubRelease,
): Promise<Map<string, string> | null> {
  // Common checksum file names.
  const checksumFileNames = [
    'checksums.txt',
    'SHA256SUMS',
    'SHA256SUMS.txt',
    'sha256sums.txt',
    'CHECKSUMS.txt',
  ]

  for (const fileName of checksumFileNames) {
    const checksumAsset = release.assets.find(
      asset => asset.name.toLowerCase() === fileName.toLowerCase(),
    )

    if (checksumAsset) {
      try {
        logger.info(`Found checksums file: ${checksumAsset.name}`)
        // Sequential fetch required to validate checksums before downloading binaries.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(checksumAsset.browser_download_url)

        if (!response.ok) {
          logger.warn(
            `Failed to download checksums file: ${response.status} ${response.statusText}`,
          )
          continue
        }

        // Sequential fetch required.
        // eslint-disable-next-line no-await-in-loop
        const content = await response.text()
        const checksums = parseChecksumsFile(content)

        if (checksums.size > 0) {
          logger.info(`Loaded ${checksums.size} checksums from release`)
          return checksums
        }
      } catch (e) {
        logger.warn(
          `Error fetching checksums from ${checksumAsset.name}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
  }

  logger.warn('No checksums file found in release assets')
  return null
}

/**
 * GitHub release information.
 */
interface GitHubRelease {
  tag_name: string
  name: string
  assets: ReleaseAsset[]
  published_at: string
  prerelease: boolean
}

/**
 * Fetch latest release information from GitHub.
 */
async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url =
    'https://api.github.com/repos/SocketDev/socket-cli/releases/latest'

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'socket-cli-self-update/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(
        `GitHub API request failed: ${response.status} ${response.statusText}`,
      )
    }

    const release = (await response.json()) as GitHubRelease

    if (!release.tag_name || !Array.isArray(release.assets)) {
      throw new Error('Invalid release data from GitHub API')
    }

    return release
  } catch (error) {
    throw new Error(
      `Failed to fetch release information: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Find the appropriate asset for the current platform.
 */
function findPlatformAsset(
  assets: ReleaseAsset[],
  expectedName: string,
): ReleaseAsset | undefined {
  return assets.find(asset => asset.name === expectedName)
}

/**
 * Download a file with progress indication.
 */
async function downloadFile(url: string, destination: string): Promise<void> {
  try {
    logger.info(`Downloading ${url}...`)

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText}`,
      )
    }

    const buffer = new Uint8Array(await response.arrayBuffer())
    await fs.writeFile(destination, buffer)

    logger.info(`Downloaded ${buffer.length} bytes to ${destination}`)
  } catch (error) {
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Verify file integrity using checksums.
 */
async function verifyFile(
  filePath: string,
  expectedChecksum?: string,
): Promise<boolean> {
  if (!expectedChecksum) {
    logger.warn('No checksum provided, skipping verification')
    return true
  }

  try {
    const content = await fs.readFile(filePath)
    const hash = crypto.createHash('sha256')
    hash.update(content)
    const actualChecksum = hash.digest('hex')

    const isValid = actualChecksum === expectedChecksum

    if (isValid) {
      logger.info('File integrity verified successfully')
    } else {
      logger.error(
        `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
      )
    }

    return isValid
  } catch (error) {
    logger.error(
      `Failed to verify file: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * Create a backup of the current binary.
 */
async function createBackup(currentPath: string): Promise<string> {
  const backupPath = `${currentPath}.backup.${Date.now()}`

  try {
    await fs.copyFile(currentPath, backupPath)
    logger.info(`Created backup at ${backupPath}`)
    return backupPath
  } catch (error) {
    throw new Error(
      `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Replace the current binary atomically.
 * Uses sfw-installer patterns for platform-specific handling.
 */
async function replaceBinary(
  newPath: string,
  currentPath: string,
): Promise<void> {
  try {
    // Ensure the new binary is executable and clear quarantine.
    await ensureExecutable(newPath)
    await clearQuarantine(newPath)

    // On Windows, we might need special handling for replacing the running executable.
    if (process.platform === 'win32') {
      // Move current binary to temp name first.
      const tempName = `${currentPath}.old.${Date.now()}`
      await fs.rename(currentPath, tempName)

      try {
        await fs.rename(newPath, currentPath)
        // Clean up old binary.
        await fs.unlink(tempName).catch(() => {})
      } catch (error) {
        // Try to restore on failure.
        await fs.rename(tempName, currentPath).catch(() => {})
        throw error
      }
    } else {
      // On Unix systems, this should be atomic.
      await fs.rename(newPath, currentPath)
    }

    logger.info('Binary replacement completed successfully')
  } catch (error) {
    throw new Error(
      `Failed to replace binary: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Check if stub needs updating and update if necessary.
 * Returns true if stub was updated, false if no update needed.
 */
async function checkAndUpdateStub(
  release: GitHubRelease,
  dryRun: boolean,
): Promise<boolean> {
  const stubPath = getIpcStubPath('socket-cli')

  // Only proceed if we have a stub path from IPC.
  if (!stubPath) {
    logger.info('No stub path received - CLI not launched via bootstrap stub')
    return false
  }

  if (!existsSync(stubPath)) {
    logger.warn(`Stub path from IPC does not exist: ${stubPath}`)
    return false
  }

  logger.info(`Checking bootstrap stub for updates: ${stubPath}`)

  try {
    // Read current stub binary and compute hash.
    const stubContent = await fs.readFile(stubPath)
    const currentHash = crypto.createHash('sha256')
    currentHash.update(stubContent)
    const currentStubHash = currentHash.digest('hex')

    logger.info(`Current stub hash: ${currentStubHash}`)

    // Fetch known-good hashes for this release version.
    const releaseChecksums = await fetchReleaseChecksums(release)

    const stubAssetName = `socket-stub-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
    const stubAsset = release.assets.find(asset => asset.name === stubAssetName)

    if (!stubAsset) {
      logger.info(
        `No stub binary found in release for ${process.platform}-${process.arch}`,
      )
      return false
    }

    logger.info(`Found stub asset: ${stubAsset.name}`)

    // Check if current stub matches the release version using checksums.
    if (releaseChecksums) {
      const expectedHash = releaseChecksums.get(stubAssetName)

      if (expectedHash) {
        if (currentStubHash === expectedHash) {
          logger.info(
            'Current stub hash matches release version - no update needed',
          )
          return false
        }

        logger.info(
          `Stub hash mismatch - current: ${currentStubHash.slice(0, 12)}..., expected: ${expectedHash.slice(0, 12)}...`,
        )
      } else {
        logger.warn(
          `No checksum found for ${stubAssetName} in release checksums file`,
        )
      }
    }

    if (dryRun) {
      logger.info('[DRY RUN] Would download and update stub')
      return false
    }

    // Download and update stub.
    logger.info('Downloading new stub...')

    const downloadsDir = getSocketCliUpdaterDownloadsDir()
    const stagingDir = getSocketCliUpdaterStagingDir()

    await fs.mkdir(downloadsDir, { recursive: true })
    await fs.mkdir(stagingDir, { recursive: true })

    const timestamp = Date.now()
    const downloadPath = path.join(
      downloadsDir,
      `${stubAsset.name}.${timestamp}`,
    )
    const stagingPath = path.join(stagingDir, `${stubAsset.name}.${timestamp}`)

    try {
      await downloadFile(stubAsset.browser_download_url, downloadPath)

      // Verify downloaded stub integrity if checksums are available.
      if (releaseChecksums) {
        const expectedHash = releaseChecksums.get(stubAssetName)

        if (expectedHash) {
          const isValid = await verifyFile(downloadPath, expectedHash)

          if (!isValid) {
            throw new Error(
              'Downloaded stub checksum verification failed - file may be corrupted or tampered with',
            )
          }
        }
      }

      // Move to staging.
      await fs.rename(downloadPath, stagingPath)

      // Create backup of current stub.
      const backupPath = await createBackup(stubPath)
      logger.info(`Created stub backup: ${backupPath}`)

      try {
        // Replace the stub binary.
        await replaceBinary(stagingPath, stubPath)

        logger.info(`${colors.green('✓')} Bootstrap stub updated successfully!`)
        return true
      } catch (error) {
        // Restore from backup on failure.
        try {
          await fs.copyFile(backupPath, stubPath)
          logger.info('Restored stub from backup after update failure')
        } catch (restoreError) {
          logger.error(
            `Failed to restore stub from backup: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          )
        }
        throw error
      }
    } finally {
      // Clean up download and staging files.
      try {
        if (existsSync(downloadPath)) {
          await remove(downloadPath)
        }
        if (existsSync(stagingPath)) {
          await remove(stagingPath)
        }
      } catch {
        // Cleanup failure is not critical.
      }
    }
  } catch (error) {
    logger.error(
      `Failed to update stub: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * Handle the self-update command.
 */
export async function handleSelfUpdate(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string; rawArgv?: readonly string[] },
): Promise<void> {
  // This command is only available when running as SEA binary.
  if (!isSeaBinary()) {
    throw new Error(
      'self-update is only available when running as a SEA binary',
    )
  }

  const config: CliCommandConfig = {
    commandName: 'self-update',
    description: 'Update Socket CLI to the latest version',
    hidden: false,
    flags: {
      ...commonFlags,
      force: {
        type: 'boolean',
        shortFlag: 'f',
        description: 'Force update even if already on latest version',
      },
      dryRun: {
        type: 'boolean',
        description: 'Check for updates without actually updating',
      },
    },
    help: command => `
Update Socket CLI to the latest version.

This command downloads and replaces the current binary with the latest version
from GitHub releases. A backup of the current binary is created automatically.

Usage
  $ ${command}

Examples
  $ ${command}                 # Update to latest version
  $ ${command} --force         # Force update even if already latest
  $ ${command} --dry-run       # Check for updates without updating
`,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })
  const { flags } = cli
  const force = Boolean(flags['force'])
  const dryRun = Boolean(flags['dryRun'])
  const currentVersion = ENV.INLINED_SOCKET_CLI_VERSION || 'unknown'
  const currentBinaryPath = process.argv[0]

  if (!currentBinaryPath) {
    throw new Error('Unable to determine current binary path')
  }

  logger.info(`Current version: ${colors.cyan(currentVersion)}`)
  logger.info(`Current binary: ${currentBinaryPath}`)

  if (!existsSync(currentBinaryPath)) {
    throw new Error(`Current binary not found at ${currentBinaryPath}`)
  }

  // Fetch latest release information.
  const release = await fetchLatestRelease()
  const latestVersion = release.tag_name.replace(/^v/, '')

  logger.info(`Latest version: ${colors.green(latestVersion)}`)

  // Check if update is needed.
  if (!force && currentVersion === latestVersion) {
    await outputSelfUpdate({
      currentVersion,
      latestVersion,
      isUpToDate: true,
      dryRun,
    })

    // Even if CLI is up to date, check if stub needs updating.
    const stubUpdated = await checkAndUpdateStub(release, dryRun)
    if (stubUpdated) {
      logger.info('Bootstrap stub has been updated to match CLI version.')
    }

    return
  }

  if (dryRun) {
    await outputSelfUpdate({
      currentVersion,
      latestVersion,
      isUpToDate: false,
      dryRun: true,
    })
    return
  }

  // Find the appropriate asset for this platform.
  const expectedAssetName = getExpectedAssetName()
  const asset = findPlatformAsset(release.assets, expectedAssetName)

  if (!asset) {
    const platformName =
      process.platform === 'win32'
        ? 'Windows'
        : process.platform === 'darwin'
          ? 'macOS'
          : 'Linux'
    const archName = process.arch === 'arm64' ? 'ARM64' : 'x64'

    let errorMessage = `❌ No SEA binary available for ${platformName} ${archName}\n`
    errorMessage += `   Expected: ${expectedAssetName}\n\n`

    // Provide platform-specific guidance
    if (process.platform === 'win32' && process.arch === 'arm64') {
      errorMessage +=
        '📋 Windows ARM64 SEA binaries are not currently supported due to:\n'
      errorMessage += '   • Cross-compilation limitations with Node.js SEA\n'
      errorMessage +=
        '   • Limited testing coverage for Windows ARM64 + postject\n'
      errorMessage +=
        '   • Code signing complexity for ARM64 Windows binaries\n\n'
      errorMessage += '💡 Recommended alternatives:\n'
      errorMessage += `   1. Use npm package: ${colors.cyan('npm install -g socket')}\n`
      errorMessage += '   2. Use Windows x64 binary (runs via emulation):\n'
      errorMessage += '      Download socket-win-x64.exe from the release\n'
    } else {
      errorMessage += '💡 Try using the npm package instead:\n'
      errorMessage += `   ${colors.cyan('npm install -g socket')}\n\n`
      errorMessage +=
        '   The npm package works on all platforms and architectures.\n'
    }

    errorMessage += '\n📚 For more details, see: docs/SEA_PLATFORM_SUPPORT.md'
    throw new Error(errorMessage)
  }

  logger.info(`Found asset: ${asset.name} (${asset.size} bytes)`)

  // Create temporary directory for download.
  const tempDir = path.join(os.tmpdir(), `socket-update-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  try {
    const tempBinaryPath = path.join(tempDir, asset.name)

    // Download the new binary.
    await downloadFile(asset.browser_download_url, tempBinaryPath)

    // Verify integrity if possible (GitHub doesn't provide checksums in release API).
    // In a production system, you'd want to verify signatures or checksums.
    await verifyFile(tempBinaryPath)

    // Create backup of current binary.
    const backupPath = await createBackup(currentBinaryPath)

    try {
      // Replace the binary.
      await replaceBinary(tempBinaryPath, currentBinaryPath)

      await outputSelfUpdate({
        currentVersion,
        latestVersion,
        isUpToDate: false,
        dryRun: false,
        updateSucceeded: true,
        backupPath,
      })

      logger.info(`${colors.green('✓')} Update completed successfully!`)
      logger.info(`Backup saved to: ${backupPath}`)

      // Check and update stub if launched via bootstrap.
      const stubUpdated = await checkAndUpdateStub(release, dryRun)
      if (stubUpdated) {
        logger.info(
          'Both CLI and bootstrap stub have been updated successfully!',
        )
      }

      logger.info('Please restart the application to use the new version.')
    } catch (error) {
      // Restore from backup on failure.
      try {
        await fs.copyFile(backupPath, currentBinaryPath)
        logger.info('Restored from backup after update failure')
      } catch (restoreError) {
        logger.error(
          `Failed to restore from backup: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        )
      }
      throw error
    }
  } finally {
    // Clean up temporary directory.
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Cleanup failure is not critical.
    }
  }
}
