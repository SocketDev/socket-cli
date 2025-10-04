/** @fileoverview Self-update handler for Socket CLI SEA binaries. Downloads and replaces binary with latest version using ~/.socket/_socket/updater directory structure. Includes rollback capabilities for failed updates.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { remove } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { outputSelfUpdate } from './output-self-update.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { httpDownload, httpGetJson } from '../../utils/http.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getSocketCliUpdaterBackupsDir,
  getSocketCliUpdaterDownloadsDir,
  getSocketCliUpdaterStagingDir,
} from '../../utils/paths.mts'
import {
  clearQuarantine,
  ensureExecutable,
  getExpectedAssetName,
} from '../../utils/platform.mts'
import { isSeaBinary } from '../../utils/sea.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

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

  const result = await httpGetJson<GitHubRelease>(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'socket-cli-self-update/1.0',
    },
  })

  if (!result.ok) {
    throw new Error(`Failed to fetch release information: ${result.message}`)
  }

  const release = result.data!

  if (!release.tag_name || !Array.isArray(release.assets)) {
    throw new Error('Invalid release data from GitHub API')
  }

  return release
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
  logger.info(`Downloading ${path.basename(destination)}...`)

  let lastProgress = 0
  const result = await httpDownload(url, destination, {
    onProgress: (downloaded, total) => {
      if (total > 0) {
        const progress = Math.floor((downloaded / total) * 100)
        // Show progress every 10%
        if (progress >= lastProgress + 10) {
          logger.info(
            `Progress: ${progress}% (${Math.floor(downloaded / 1024 / 1024)}MB / ${Math.floor(total / 1024 / 1024)}MB)`,
          )
          lastProgress = progress
        }
      }
    },
  })

  if (!result.ok) {
    throw new Error(`Failed to download file: ${result.message}`)
  }

  logger.info(`Downloaded ${Math.floor(result.data!.size / 1024 / 1024)}MB`)
}

/**
 * Verify file integrity using checksums.
 */
async function verifyFile(
  filePath: string,
  expectedChecksum?: string | undefined,
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
 * Create a backup of the current binary in ~/.socket/_socket/updater/backups.
 * Uses timestamp-based naming for tracking multiple backups.
 */
async function createBackup(currentPath: string): Promise<string> {
  const backupsDir = getSocketCliUpdaterBackupsDir()
  const binaryName = path.basename(currentPath)
  const timestamp = Date.now()
  const backupPath = path.join(backupsDir, `${binaryName}.backup.${timestamp}`)

  try {
    // Ensure backups directory exists.
    await fs.mkdir(backupsDir, { recursive: true })

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
        await remove(tempName).catch(() => {})
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
 * Handle the self-update command.
 */
export async function handleSelfUpdate(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  {
    parentName,
  }: { parentName: string; rawArgv?: readonly string[] | undefined },
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
  const currentVersion = constants.ENV['INLINED_SOCKET_CLI_VERSION']
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
      errorMessage += `📋 Windows ARM64 SEA binaries are not currently supported due to:\n`
      errorMessage += `   • Cross-compilation limitations with Node.js SEA\n`
      errorMessage += `   • Limited testing coverage for Windows ARM64 + postject\n`
      errorMessage += `   • Code signing complexity for ARM64 Windows binaries\n\n`
      errorMessage += `💡 Recommended alternatives:\n`
      errorMessage += `   1. Use npm package: ${colors.cyan('npm install -g socket')}\n`
      errorMessage += `   2. Use Windows x64 binary (runs via emulation):\n`
      errorMessage += `      Download socket-win-x64.exe from the release\n`
    } else {
      errorMessage += `💡 Try using the npm package instead:\n`
      errorMessage += `   ${colors.cyan('npm install -g socket')}\n\n`
      errorMessage += `   The npm package works on all platforms and architectures.\n`
    }

    errorMessage += `\n📚 For more details, see: docs/SEA_PLATFORM_SUPPORT.md`
    throw new Error(errorMessage)
  }

  logger.info(`Found asset: ${asset.name} (${asset.size} bytes)`)

  // Use proper updater directory structure (~/.socket/_socket/updater).
  const downloadsDir = getSocketCliUpdaterDownloadsDir()
  const stagingDir = getSocketCliUpdaterStagingDir()

  // Ensure directories exist.
  await fs.mkdir(downloadsDir, { recursive: true })
  await fs.mkdir(stagingDir, { recursive: true })

  // Create unique download path with timestamp.
  const timestamp = Date.now()
  const downloadPath = path.join(downloadsDir, `${asset.name}.${timestamp}`)
  const stagingPath = path.join(stagingDir, `${asset.name}.${timestamp}`)

  try {
    // Download the new binary to downloads directory.
    await downloadFile(asset.browser_download_url, downloadPath)

    // Verify integrity if possible (GitHub doesn't provide checksums in release API).
    // In a production system, you'd want to verify signatures or checksums.
    await verifyFile(downloadPath)

    // Move to staging for final preparation.
    await fs.rename(downloadPath, stagingPath)

    // Create backup of current binary in backups directory.
    const backupPath = await createBackup(currentBinaryPath)

    try {
      // Replace the binary.
      await replaceBinary(stagingPath, currentBinaryPath)

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
      logger.info('Please restart the application to use the new version.')

      // Clean up staging file after successful update.
      try {
        await remove(stagingPath)
      } catch {
        // Cleanup failure is not critical.
      }
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
    // Clean up download and staging files if they still exist.
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
}
