/**
 * Create symlinks for the unified Socket CLI SEA binary.
 *
 * This script creates symlinks so that the single SEA binary can be
 * invoked as different commands:
 * - socket -> socket (main binary)
 * - socket-npm -> socket
 * - socket-npx -> socket
 * - socket-pnpm -> socket
 * - socket-yarn -> socket
 *
 * The bootstrap detects how it was invoked and routes to the appropriate
 * Socket CLI command.
 *
 * Usage:
 *   node scripts/create-sea-symlinks.mjs ./socket ./output-dir
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const COMMANDS = ['socket-npm', 'socket-npx', 'socket-pnpm', 'socket-yarn']

async function createSymlinks(binaryPath, outputDir) {
  const binaryName = path.basename(binaryPath)
  const isWindows = process.platform === 'win32'

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  console.log(`Creating symlinks for ${binaryName}...`)

  for (const command of COMMANDS) {
    const symlinkName = isWindows ? `${command}.exe` : command
    const symlinkPath = path.join(outputDir, symlinkName)

    try {
      // Remove existing symlink if it exists
      await fs.unlink(symlinkPath).catch(() => {})

      if (isWindows) {
        // On Windows, copy the executable instead of symlinking
        // (symlinks require admin privileges)
        console.log(`  Copying ${binaryName} -> ${symlinkName}`)
        await fs.copyFile(binaryPath, symlinkPath)
      } else {
        // On Unix, create a symlink
        console.log(`  Linking ${symlinkName} -> ${binaryName}`)
        await fs.symlink(binaryName, symlinkPath)
      }
    } catch (error) {
      console.error(`  Failed to create ${symlinkName}: ${error.message}`)
    }
  }

  console.log('Symlinks created successfully!')

  if (!isWindows) {
    console.log('\nTo test the symlinks:')
    for (const command of COMMANDS) {
      console.log(`  ./${path.join(outputDir, command)} --help`)
    }
  }
}

// CLI usage
async function main() {
  const [, , binaryPath, outputDir] = process.argv

  if (!binaryPath) {
    console.error(
      'Usage: node create-sea-symlinks.mjs <binary-path> [output-dir]',
    )
    console.error('Example: node create-sea-symlinks.mjs ./socket ./dist')
    process.exit(1)
  }

  const resolvedBinaryPath = path.resolve(binaryPath)
  const resolvedOutputDir = outputDir
    ? path.resolve(outputDir)
    : path.dirname(resolvedBinaryPath)

  // Check if binary exists
  try {
    await fs.access(resolvedBinaryPath)
  } catch {
    console.error(`Error: Binary not found at ${resolvedBinaryPath}`)
    process.exit(1)
  }

  await createSymlinks(resolvedBinaryPath, resolvedOutputDir)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error:', error)
    process.exit(1)
  })
}

export { createSymlinks }
