/**
 * Shared bootstrap utilities for Socket CLI.
 * Used by both npm wrapper and smol binary.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { gte } from 'semver'

import { whichReal } from '@socketsecurity/lib/bin'
import { SOCKET_IPC_HANDSHAKE } from '@socketsecurity/lib/constants/socket'
import { downloadPackage } from '@socketsecurity/lib/dlx/package'
import { envAsBoolean } from '@socketsecurity/lib/env'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { Spinner, withSpinner } from '@socketsecurity/lib/spinner'

import { SOCKET_CLI_ISSUES_URL } from '../../../cli/src/constants/socket.mts'

const logger = getDefaultLogger()

export const SOCKET_DLX_DIR = path.join(homedir(), '.socket', '_dlx')

/**
 * Environment variable to disable node forwarding and use stub instead.
 * Set to '1', 'true', or 'yes' to disable forwarding (useful for e2e testing).
 */
const SOCKET_CLI_DISABLE_NODE_FORWARDING = envAsBoolean(
  process.env.SOCKET_CLI_DISABLE_NODE_FORWARDING,
)

/**
 * Minimum Node.js version with SEA support.
 * This constant is injected at build time by esbuild from .config/node-version.mjs.
 * @type {string}
 */
// @ts-expect-error - Injected by esbuild define.
const MIN_NODE_VERSION = __MIN_NODE_VERSION__

/**
 * Socket CLI version.
 * This constant is injected at build time by esbuild.
 * @type {string}
 */
// @ts-expect-error - Injected by esbuild define.
export const SOCKET_CLI_VERSION = __SOCKET_CLI_VERSION__

/**
 * Get CLI package paths.
 */
export function getCliPaths(cliPackageDir) {
  if (!cliPackageDir) {
    throw new Error('CLI package directory not initialized')
  }
  return {
    cliEntry: path.join(
      cliPackageDir,
      'node_modules',
      '@socketsecurity',
      'cli',
      'dist',
      'index.js',
    ),
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
    const nodePath = await whichReal('node', { nothrow: true })
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
    const nodePath = await whichReal('node', { all: true, nothrow: true })

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

  try {
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
          extra: {
            bootstrapBinaryPath: process.argv[1] || process.execPath,
          },
        },
      })
    }

    return result.code ?? 0
  } catch (e) {
    // Spawn throws when child exits with non-zero code.
    // Extract the exit code from the error.
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      typeof e.code === 'number'
    ) {
      return e.code
    }
    throw e
  }
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
      spinner: Spinner(),
      operation: async () =>
        // Download and cache @socketsecurity/cli package.
        // Uses caret range (^) to auto-update within same major version.
        // Update notifications will only trigger for major version changes.
        await downloadPackage({
          // @ts-expect-error - Injected by esbuild define.
          package: '@socketsecurity/cli@^' + __SOCKET_CLI_VERSION_MAJOR__,
          binaryName: 'socket',
          // Use cached version if available.
          force: false,
        }),
    })

    return result
  } catch (e) {
    logger.error('Failed to download Socket CLI')
    logger.error(`   Error: ${e instanceof Error ? e.message : String(e)}`)
    logger.error('')
    // @ts-expect-error - Injected by esbuild define.
    if (!INLINED_SOCKET_BOOTSTRAP_PUBLISHED_BUILD) {
      logger.error(
        'For local development, set SOCKET_CLI_LOCAL_PATH to your CLI build:',
      )
      logger.error(
        `   export SOCKET_CLI_LOCAL_PATH=/path/to/socket-cli/packages/cli/dist/index.js`,
      )
      logger.error('')
      logger.error('Or try:')
    } else {
      logger.error('Please try:')
    }
    logger.error('  1. Check internet connection')
    logger.error('  2. Try running command again')
    logger.error(`  3. Report issue: ${SOCKET_CLI_ISSUES_URL}`)
    process.exit(1)
  }
}

/**
 * Find and execute the CLI from the downloaded package.
 * Returns exit code from CLI execution.
 */
export async function findAndExecuteCli(args) {
  // Check if using local CLI path override (for testing).
  const localCliPath = process.env.SOCKET_CLI_LOCAL_PATH
  if (localCliPath && existsSync(localCliPath)) {
    return await executeCli(localCliPath, args)
  }

  // Download CLI if needed.
  const result = await downloadCli()
  const cliPackageDir = result.packageDir

  // Pass metadata to CLI for manifest writing.
  // CLI will use this to write entries to ~/.socket/_dlx/.dlx-manifest.json
  // @ts-expect-error - Injected by esbuild define.
  const spec = '@socketsecurity/cli@^' + __SOCKET_CLI_VERSION_MAJOR__
  process.env.SOCKET_CLI_BOOTSTRAP_SPEC = spec
  process.env.SOCKET_CLI_BOOTSTRAP_CACHE_DIR = cliPackageDir

  // Get CLI entry path (dist/index.js handles brotli decompression internally).
  const { cliEntry } = getCliPaths(cliPackageDir)

  // Execute the CLI loader.
  if (existsSync(cliEntry)) {
    return await executeCli(cliEntry, args)
  }

  // If we can't find the CLI, exit with error.
  logger.error('Socket CLI installation failed')
  logger.error('   CLI entry point not found after installation')
  logger.error(`   Looked in: ${cliEntry}`)
  return 1
}
