/**
 * Handle self-update command logic.
 *
 * This implements the actual self-update functionality using npm registry
 * to download @socketbin packages with rollback capabilities.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { detectPackageManager } from '@socketsecurity/lib/env/package-manager'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getIpcStubPath } from '@socketsecurity/lib/ipc'
import { logger } from '@socketsecurity/lib/logger'

import { outputSelfUpdate } from './output-self-update.mts'
import ENV from '../../constants/env.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  clearQuarantine,
  ensureExecutable,
  getBinaryRelativePath,
  getSocketbinPackageName,
} from '../../utils/process/os.mjs'
import {
  downloadTarball,
  extractBinaryFromTarball,
  fetchPackageMetadata,
  verifyTarballIntegrity,
} from '../../utils/registry/npm-registry.mts'
import { canSelfUpdate, isSeaBinary } from '../../utils/sea/detect.mjs'

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
 * Update bootstrap stub binary using npm registry.
 * Returns true if stub was updated, false if no update needed.
 */
async function updateStubBinary(
  latestVersion: string,
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

  if (dryRun) {
    logger.info('[DRY RUN] Would download and update stub')
    return false
  }

  try {
    // Fetch stub package metadata from npm registry.
    const stubPackageName = getSocketbinPackageName()
    logger.info(
      `Fetching stub package metadata: ${stubPackageName}@${latestVersion}`,
    )

    const metadata = await fetchPackageMetadata(stubPackageName, latestVersion)

    if (!metadata.dist?.tarball || !metadata.dist?.integrity) {
      throw new Error('Invalid package metadata from npm registry')
    }

    logger.info('Downloading new stub package...')

    const downloadsDir = getSocketCliUpdaterDownloadsDir()
    const stagingDir = getSocketCliUpdaterStagingDir()

    await safeMkdir(downloadsDir, { recursive: true })
    await safeMkdir(stagingDir, { recursive: true })

    const timestamp = Date.now()
    const tarballPath = path.join(downloadsDir, `stub-${timestamp}.tgz`)
    const stagingPath = path.join(stagingDir, `stub-${timestamp}`)

    try {
      // Download tarball.
      await downloadTarball(metadata.dist.tarball, tarballPath)

      // Verify integrity.
      const isValid = await verifyTarballIntegrity(
        tarballPath,
        metadata.dist.integrity,
      )

      if (!isValid) {
        throw new Error(
          'Stub package integrity verification failed - file may be corrupted or tampered with',
        )
      }

      // Extract stub binary from tarball.
      const binaryRelativePath = getBinaryRelativePath()
      const extractedPath = await extractBinaryFromTarball(
        tarballPath,
        binaryRelativePath,
        stagingPath,
      )

      // Create backup of current stub.
      const backupPath = await createBackup(stubPath)
      logger.info(`Created stub backup: ${backupPath}`)

      try {
        // Replace the stub binary.
        await replaceBinary(extractedPath, stubPath)

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
        if (existsSync(tarballPath)) {
          await remove(tarballPath)
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
  // This command is only available for standalone SEA binaries in ~/.socket/_dlx/.
  // Not available for npm/pnpm/yarn-installed packages.
  if (!canSelfUpdate()) {
    // Detect which package manager was used
    const packageManager = detectPackageManager()

    let updateCommand: string
    let installedVia: string

    if (packageManager === 'npm') {
      updateCommand = 'npm update -g socket'
      installedVia = 'npm'
    } else if (packageManager === 'pnpm') {
      updateCommand = 'pnpm update -g socket'
      installedVia = 'pnpm'
    } else if (packageManager === 'yarn') {
      updateCommand = 'yarn global upgrade socket'
      installedVia = 'yarn'
    } else if (packageManager === 'bun') {
      updateCommand = 'bun update -g socket'
      installedVia = 'bun'
    } else if (isSeaBinary()) {
      // SEA binary but not in DLX (e.g., manually installed to /usr/local/bin)
      updateCommand =
        'curl -sSL https://raw.githubusercontent.com/SocketDev/socket-cli/main/install.sh | sh'
      installedVia = 'manual installation'
    } else {
      // Bootstrap wrapper - unknown package manager
      updateCommand = 'npm update -g socket'
      installedVia = 'a package manager'
    }

    throw new Error(
      'self-update is only available for Socket CLI binaries managed by Socket.\n\n' +
        `You installed Socket CLI via ${installedVia}. To update, run:\n` +
        `  ${colors.cyan(updateCommand)}`,
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
from npm registry. A backup of the current binary is created automatically.

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

  // Fetch latest version from npm registry.
  const packageName = getSocketbinPackageName()
  logger.info(`Fetching latest version from npm: ${packageName}`)

  const metadata = await fetchPackageMetadata(packageName, 'latest')
  const latestVersion = metadata.version

  if (!metadata.dist?.tarball || !metadata.dist?.integrity) {
    throw new Error('Invalid package metadata from npm registry')
  }

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
    const stubUpdated = await updateStubBinary(latestVersion, dryRun)
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

  // Create temporary directory for download.
  const tempDir = path.join(os.tmpdir(), `socket-update-${Date.now()}`)
  await safeMkdir(tempDir, { recursive: true })

  try {
    const tarballPath = path.join(tempDir, 'package.tgz')
    const extractedBinaryPath = path.join(tempDir, 'socket-binary')

    logger.info(`Downloading package: ${metadata.dist.tarball}`)

    // Download tarball.
    await downloadTarball(metadata.dist.tarball, tarballPath)

    // Verify integrity.
    logger.info('Verifying package integrity...')
    const isValid = await verifyTarballIntegrity(
      tarballPath,
      metadata.dist.integrity,
    )

    if (!isValid) {
      throw new Error(
        'Package integrity verification failed - file may be corrupted or tampered with',
      )
    }

    // Extract binary from tarball.
    logger.info('Extracting binary from package...')
    const binaryRelativePath = getBinaryRelativePath()
    await extractBinaryFromTarball(
      tarballPath,
      binaryRelativePath,
      extractedBinaryPath,
    )

    // Create backup of current binary.
    const backupPath = await createBackup(currentBinaryPath)

    try {
      // Replace the binary.
      await replaceBinary(extractedBinaryPath, currentBinaryPath)

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
      const stubUpdated = await updateStubBinary(latestVersion, dryRun)
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
