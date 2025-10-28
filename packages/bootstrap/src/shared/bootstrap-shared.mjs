/**
 * Shared bootstrap utilities for Socket CLI.
 * Used by both npm wrapper and smol binary.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import { dlxPackage } from '@socketsecurity/lib/dlx-package'

export const SOCKET_DLX_DIR = path.join(homedir(), '.socket', '_dlx')

/**
 * Get CLI package paths.
 */
export function getCliPaths(cliPackageDir) {
  if (!cliPackageDir) {
    throw new Error('CLI package directory not initialized')
  }
  return {
    cliEntry: path.join(cliPackageDir, 'node_modules', '@socketsecurity', 'cli', 'dist', 'index.js'),
    cliEntryBz: path.join(cliPackageDir, 'node_modules', '@socketsecurity', 'cli', 'dist', 'cli.js.bz'),
  }
}

/**
 * Get command-line arguments.
 */
export function getArgs() {
  return process.argv ? process.argv.slice(2) : []
}

/**
 * Check if system has modern Node.js (>=24.10.0).
 */
export function hasModernNode() {
  const version = process.version // e.g., 'v24.10.0'.
  const match = version.match(/^v(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return false
  }

  const [, major, minor] = match.map(Number)
  return major > 24 || (major === 24 && minor >= 10)
}

/**
 * Execute the CLI with the given arguments.
 */
export function executeCli(cliPath, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
    },
    stdio: 'inherit',
  })
  process.exit(result.status ?? 0)
}

/**
 * Execute brotli-compressed CLI.
 */
export function executeCompressedCli(bzPath, args) {
  // Read compressed file.
  const compressed = readFileSync(bzPath)

  // Decompress with brotli.
  const decompressed = brotliDecompressSync(compressed)

  // Write to temporary file and execute.
  // Using a temp file allows us to maintain spawn behavior for proper stdio handling.
  const tempCliPath = path.join(tmpdir(), `socket-cli-${process.pid}.js`)
  writeFileSync(tempCliPath, decompressed)

  try {
    executeCli(tempCliPath, args)
  } finally {
    // Clean up temp file.
    try {
      unlinkSync(tempCliPath)
    } catch {
      // Ignore cleanup errors.
    }
  }
}

/**
 * Download and install CLI using dlxPackage.
 */
export async function downloadCli() {
  process.stderr.write('📦 Socket CLI not found, downloading...\n')
  process.stderr.write('\n')

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

    process.stderr.write(`   Installed to: ${result.packageDir}\n`)

    // Wait for installation to complete (but the spawn will fail since we don't have a command).
    // That's okay - we just need the package installed.
    try {
      await result.spawnPromise
    } catch {
      // Ignore execution errors - we only care that the package was installed.
    }

    process.stderr.write('✅ Socket CLI installed successfully\n')
    process.stderr.write('\n')

    return result
  } catch (e) {
    process.stderr.write('❌ Failed to download Socket CLI\n')
    process.stderr.write(`   Error: ${e instanceof Error ? e.message : String(e)}\n`)
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

  // Get paths.
  const { cliEntry, cliEntryBz } = getCliPaths(cliPackageDir)

  // Check for brotli-compressed CLI first.
  if (existsSync(cliEntryBz)) {
    executeCompressedCli(cliEntryBz, args)
  }

  // Fallback to uncompressed CLI.
  if (existsSync(cliEntry)) {
    executeCli(cliEntry, args)
  }

  // If we still can't find the CLI, exit with error.
  process.stderr.write('❌ Socket CLI installation failed\n')
  process.stderr.write('   CLI entry point not found after installation\n')
  process.stderr.write(`   Looked in: ${cliEntry}\n`)
  process.exit(1)
}
