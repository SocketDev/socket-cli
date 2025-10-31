/**
 * Shared bootstrap utilities for Socket CLI.
 * Used by both npm wrapper and smol binary.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { which } from '@socketsecurity/lib/bin'
import { SOCKET_IPC_HANDSHAKE } from '@socketsecurity/lib/constants/socket'
import { downloadPackage } from '@socketsecurity/lib/dlx-package'
import { envAsBoolean } from '@socketsecurity/lib/env'
import { logger } from '@socketsecurity/lib/logger'
import { Spinner, withSpinner } from '@socketsecurity/lib/spinner'
import { spawn } from '@socketsecurity/lib/spawn'
import { gte } from 'semver'
import { SOCKET_CLI_ISSUES_URL } from '../../../cli/src/constants/socket.mts'

export const SOCKET_DLX_DIR = path.join(homedir(), '.socket', '_dlx')

/**
 * Environment variable to disable node forwarding and use stub instead.
 * Set to '1', 'true', or 'yes' to disable forwarding (useful for e2e testing).
 */
const SOCKET_CLI_DISABLE_NODE_FORWARDING = envAsBoolean(
  process.env.SOCKET_CLI_DISABLE_NODE_FORWARDING
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
    const nodePath = await which('node', { nothrow: true })
    return nodePath || null
  } catch {
    return null
  }
}

/**
 * Check if we should forward to system Node.js.
 * Returns false if SOCKET_CLI_DISABLE_NODE_FORWARDING is set (for e2e testing).
 */
export async function shouldForwardToSystemNode() {
  if (SOCKET_CLI_DISABLE_NODE_FORWARDING) {
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
 * Find system Node.js binary (excluding the current SEA binary).
 */
async function findSystemNode() {
  try {
    const nodePath = await which('node', { all: true, nothrow: true })

    if (!nodePath) {
      return undefined
    }

    // which with all:true returns string[] if multiple matches, string if single match.
    const nodePaths = Array.isArray(nodePath) ? nodePath : [nodePath]

    // Find first Node.js that isn't our SEA binary.
    const currentExecPath = process.execPath
    const systemNode = nodePaths.find(p => p !== currentExecPath)

    return systemNode
  } catch {
    return undefined
  }
}

/**
 * Execute the CLI with the given arguments.
 */
export async function executeCli(cliPath, args) {
  // Try to find system Node.js (excluding ourselves if we're a SEA binary).
  const systemNode = await findSystemNode()
  const nodePath = systemNode ?? process.execPath

  // Always use IPC channel and send handshake.
  // System Node.js will ignore the handshake message.
  // SEA subprocess will use it to skip bootstrap.
  const result = await spawn(nodePath, [cliPath, ...args], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })

  // Send IPC handshake to subprocess.
  if (result.process && typeof result.process.send === 'function') {
    result.process.send({
      [SOCKET_IPC_HANDSHAKE]: {
        subprocess: true,
        parent_pid: process.pid,
      },
    })
  }

  process.exit(result.code ?? 0)
}

/**
 * Download and install CLI using dlxPackage.
 */
export async function downloadCli() {
  // Create DLX directory with recursive option to ensure all parents exist.
  try {
    mkdirSync(SOCKET_DLX_DIR, { recursive: true })
  } catch (e) {
    logger.error('Failed to create Socket directory')
    logger.error(`   Error: ${e instanceof Error ? e.message : String(e)}`)
    logger.error(`   Path: ${SOCKET_DLX_DIR}`)
    process.exit(1)
  }

  try {
    const result = await withSpinner({
      message: 'Socket powering up…',
      spinner: Spinner({ shimmer: { dir: 'random' } }),
      operation: async () =>
        // Download and cache @socketsecurity/cli package.
        await downloadPackage({
          package: '@socketsecurity/cli',
          binaryName: 'socket',
          // Use cached version if available.
          force: false,
        }),
    })

    logger.log('')

    return result
  } catch (e) {
    logger.error('Failed to download Socket CLI')
    logger.error(`   Error: ${e instanceof Error ? e.message : String(e)}`)
    logger.error('')
    logger.error('This may be a temporary issue. Please try:')
    logger.error('  1. Check your internet connection')
    logger.error('  2. Try running the command again')
    logger.error(`  3. Manually create directory: mkdir -p "${SOCKET_DLX_DIR}"`)
    logger.error(`  4. Report issue at: ${SOCKET_CLI_ISSUES_URL}`)
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
