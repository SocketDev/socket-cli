/**
 * Shared bootstrap utilities for Socket CLI.
 * Used by both npm wrapper and smol binary.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { whichBin } from '@socketsecurity/lib/bin'
import { dlxPackage } from '@socketsecurity/lib/dlx-package'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { gte } from 'semver'

export const SOCKET_DLX_DIR = path.join(homedir(), '.socket', '_dlx')

/**
 * Environment variable to disable node forwarding and use stub instead.
 * Set to '1', 'true', or 'yes' to disable forwarding (useful for e2e testing).
 */
const SOCKET_DISABLE_NODE_FORWARDING = ['1', 'true', 'yes'].includes(
  process.env.SOCKET_DISABLE_NODE_FORWARDING?.toLowerCase()
)

/**
 * Minimum Node.js version with SEA support.
 * This constant is injected at build time by esbuild from .config/node-version.mjs.
 * @type {string}
 */
// @ts-expect-error - Injected by esbuild define.
const MIN_NODE_VERSION = __MIN_NODE_VERSION__

/**
 * Get CLI package paths.
 */
export function getCliPaths(cliPackageDir) {
  if (!cliPackageDir) {
    throw new Error('CLI package directory not initialized')
  }
  return {
    cliEntry: path.join(cliPackageDir, 'node_modules', '@socketsecurity', 'cli', 'dist', 'index.js'),
  }
}

/**
 * Get command-line arguments.
 */
export function getArgs() {
  return process.argv ? process.argv.slice(2) : []
}

/**
 * Check if system has modern Node.js (>=24.10.0) with SEA support.
 */
export function hasModernNode() {
  try {
    return gte(process.version, MIN_NODE_VERSION)
  } catch {
    return false
  }
}

/**
 * Detect if Node.js is available on the system.
 */
export async function detectSystemNode() {
  try {
    const nodePath = await whichBin('node', { nothrow: true })
    return nodePath || null
  } catch {
    return null
  }
}

/**
 * Check if we should forward to system Node.js.
 * Returns false if SOCKET_DISABLE_NODE_FORWARDING is set (for e2e testing).
 */
export async function shouldForwardToSystemNode() {
  if (SOCKET_DISABLE_NODE_FORWARDING) {
    return false
  }
  const nodePath = await detectSystemNode()
  if (!nodePath) {
    return false
  }
  // Check if system node meets minimum version requirements.
  try {
    const result = await spawn(nodePath, ['--version'], {
      stdio: 'pipe',
    })
    const version = result.stdout.trim()
    return gte(version, MIN_NODE_VERSION)
  } catch {
    return false
  }
}

/**
 * Execute the CLI with the given arguments.
 */
export async function executeCli(cliPath, args) {
  const result = await spawn(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
    },
    stdio: 'inherit',
  })
  process.exit(result.code ?? 0)
}

/**
 * Download and install CLI using dlxPackage.
 */
export async function downloadCli() {
  logger.log('📦 Socket CLI not found, downloading...')
  logger.log('')

  // Create directories.
  mkdirSync(SOCKET_DLX_DIR, { recursive: true })

  try {
    // Use dlxPackage to download and install @socketsecurity/cli.
    const result = await dlxPackage(
      [], // Empty args - we don't want to execute anything.
      {
        force: false, // Use cached version if available.
        package: '@socketsecurity/cli',
        spawnOptions: {
          stdio: 'pipe', // Suppress output from the package execution.
        },
      },
    )

    logger.log(`   Installed to: ${result.packageDir}`)

    // Wait for installation to complete (but the spawn will fail since we don't have a command).
    // That's okay - we just need the package installed.
    try {
      await result.spawnPromise
    } catch {
      // Ignore execution errors - we only care that the package was installed.
    }

    logger.log('✅ Socket CLI installed successfully')
    logger.log('')

    return result
  } catch (e) {
    logger.error('Failed to download Socket CLI')
    logger.error(`   Error: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

/**
 * Find and execute the CLI from the downloaded package.
 */
export async function findAndExecuteCli(args) {
  // Download CLI if needed.
  const result = await downloadCli()
  const cliPackageDir = result.packageDir

  // Get CLI entry path (dist/index.js handles brotli decompression internally).
  const { cliEntry } = getCliPaths(cliPackageDir)

  // Execute the CLI loader.
  if (existsSync(cliEntry)) {
    await executeCli(cliEntry, args)
  }

  // If we can't find the CLI, exit with error.
  logger.error('Socket CLI installation failed')
  logger.error('   CLI entry point not found after installation')
  logger.error(`   Looked in: ${cliEntry}`)
  process.exit(1)
}
