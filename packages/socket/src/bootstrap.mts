/**
 * Bootstrap loader for Socket CLI npm wrapper package.
 *
 * This script handles three scenarios:
 * 1. Brotli-compressed CLI exists -> decompress and execute
 * 2. Uncompressed CLI exists -> execute directly
 * 3. CLI not found -> download from npm using dlxPackage, then execute
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import type { DlxPackageResult } from '@socketsecurity/lib/dlx-package'

import { dlxPackage } from '@socketsecurity/lib/dlx-package'

const SOCKET_DLX_DIR = path.join(homedir(), '.socket', '_dlx')

// Note: CLI_PACKAGE_DIR will be dynamically determined by dlxPackage.
let cliPackageDir: string | undefined
let cliEntry: string | undefined
let cliEntryBz: string | undefined

/**
 * Get paths for CLI package.
 */
function getCliPaths(): { cliEntry: string; cliEntryBz: string } {
  if (!cliPackageDir) {
    throw new Error('CLI package directory not initialized')
  }
  return {
    cliEntry: path.join(cliPackageDir, 'node_modules', '@socketsecurity', 'cli', 'dist', 'cli.js'),
    cliEntryBz: path.join(cliPackageDir, 'node_modules', '@socketsecurity', 'cli', 'dist', 'cli.js.bz'),
  }
}

/**
 * Get command-line arguments.
 */
function getArgs(): string[] {
  return process.argv ? process.argv.slice(2) : []
}

/**
 * Execute the CLI with the given arguments.
 */
function executeCli(cliPath: string, args: string[]): never {
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
function executeCompressedCli(bzPath: string, args: string[]): never {
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
async function downloadCli(): Promise<DlxPackageResult> {
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

    // Save the package directory for later use.
    cliPackageDir = result.packageDir

    process.stderr.write(`   Installed to: ${cliPackageDir}\n`)

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
 * Main bootstrap logic.
 */
async function main(): Promise<void> {
  const args = getArgs()

  // Check if CLI is already installed by trying to locate it in dlx cache.
  // We need to download it first to find out where it is.
  await downloadCli()

  // Now get the paths.
  const { cliEntry, cliEntryBz } = getCliPaths()

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

// Run the bootstrap.
main().catch((e) => {
  process.stderr.write(`❌ Bootstrap error: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
