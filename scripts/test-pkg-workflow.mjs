/**
 * @fileoverview Test the complete pkg workflow with custom Node.js build
 *
 * This script tests the actual use case: building a pkg executable with the
 * custom Node.js binary and testing that executable.
 *
 * Usage:
 *   node scripts/test-pkg-workflow.mjs                    # Full workflow
 *   node scripts/test-pkg-workflow.mjs --skip-build       # Skip Socket CLI build
 *   node scripts/test-pkg-workflow.mjs --skip-pkg         # Skip pkg step
 */

import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '..')

// Parse arguments.
const args = process.argv.slice(2)
const SKIP_BUILD = args.includes('--skip-build')
const SKIP_PKG = args.includes('--skip-pkg')
const NODE_VERSION = 'v24.10.0'

// Determine platform-specific executable name.
const ARCH = process.arch
const PLATFORM = platform()
const PKG_BINARY =
  PLATFORM === 'darwin'
    ? `socket-macos-${ARCH}`
    : PLATFORM === 'win32'
      ? `socket-win-${ARCH}.exe`
      : `socket-linux-${ARCH}`
const PKG_BINARY_PATH = join(ROOT_DIR, 'pkg-binaries', PKG_BINARY)

// Verify custom Node binary exists.
const pkgCacheDir = join(
  process.env.HOME || process.env.USERPROFILE,
  '.pkg-cache',
  'v3.5',
)
const IS_MACOS = PLATFORM === 'darwin'
const targetName = `built-${NODE_VERSION}-${PLATFORM}-${ARCH}${IS_MACOS && ARCH === 'arm64' ? '-signed' : ''}`
const CUSTOM_NODE_PATH = join(pkgCacheDir, targetName)

/**
 * Main workflow.
 */
async function main() {
  logger.log(`🔨 Testing pkg workflow with custom Node.js ${NODE_VERSION}`)
  logger.logNewline()

  // Step 1: Verify custom Node exists.
  logger.step('Verifying custom Node binary...')
  if (!existsSync(CUSTOM_NODE_PATH)) {
    logger.fail(`Custom Node binary not found: ${CUSTOM_NODE_PATH}`)
    logger.substep('Run: node scripts/build-yao-pkg-node.mjs')
    process.exit(1)
  }
  logger.success(`Custom Node binary found: ${CUSTOM_NODE_PATH}`)
  logger.logNewline()

  // Step 2: Build Socket CLI dist.
  if (!SKIP_BUILD) {
    logger.step('Building Socket CLI...')
    try {
      await spawn('pnpm', ['run', 'build'], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      })
      logger.success('Socket CLI build completed')
    } catch (e) {
      logger.fail('Socket CLI build failed')
      logger.substep(e.message)
      process.exit(1)
    }
  } else {
    logger.info('Skipping Socket CLI build (--skip-build)')
  }
  logger.logNewline()

  // Step 3: Create pkg executable.
  if (!SKIP_PKG) {
    logger.step('Creating pkg executable...')
    logger.substep(`Output: ${PKG_BINARY_PATH}`)
    logger.substep(`Target: node24-${PLATFORM}-${ARCH}`)
    try {
      await spawn(
        'pnpm',
        ['exec', 'pkg', '.', '--targets', `node24-${PLATFORM}-${ARCH}`],
        {
          cwd: ROOT_DIR,
          stdio: 'inherit',
        },
      )
      logger.success('pkg executable created')
    } catch (e) {
      logger.fail('pkg creation failed')
      logger.substep(e.message)
      process.exit(1)
    }
  } else {
    logger.info('Skipping pkg creation (--skip-pkg)')
  }
  logger.logNewline()

  // Step 4: Verify executable exists.
  logger.step('Verifying pkg executable...')
  if (!existsSync(PKG_BINARY_PATH)) {
    logger.fail(`Executable not found: ${PKG_BINARY_PATH}`)
    logger.substep('pkg may have failed silently')
    process.exit(1)
  }

  const sizeResult = await spawn('du', ['-h', PKG_BINARY_PATH], {
    stdio: 'pipe',
  })
  const size = sizeResult.stdout ? sizeResult.stdout.split('\t')[0] : 'unknown'
  logger.success(`Executable exists: ${size}`)
  logger.logNewline()

  // Step 5: Test executable.
  logger.step('Testing pkg executable...')

  // Test 1: Version check.
  logger.substep('Test 1: Version check')
  try {
    const versionResult = await spawn(PKG_BINARY_PATH, ['--version'], {
      stdio: 'pipe',
    })
    if (versionResult.code === 0 && versionResult.stdout) {
      logger.success(`Version: ${versionResult.stdout.trim()}`)
    } else {
      logger.fail('Version check failed')
      process.exit(1)
    }
  } catch (e) {
    logger.fail(`Version check error: ${e.message}`)
    process.exit(1)
  }

  // Test 2: Help command.
  logger.substep('Test 2: Help command')
  try {
    const helpResult = await spawn(PKG_BINARY_PATH, ['--help'], {
      stdio: 'pipe',
    })
    if (helpResult.code === 0 && helpResult.stdout) {
      logger.success('Help command works')
    } else {
      logger.fail('Help command failed')
      process.exit(1)
    }
  } catch (e) {
    logger.fail(`Help command error: ${e.message}`)
    process.exit(1)
  }

  // Test 3: Simple command execution.
  logger.substep('Test 3: Simple command (socket --version)')
  try {
    const cmdResult = await spawn(PKG_BINARY_PATH, [], {
      stdio: 'pipe',
    })
    // socket with no args should show help or version
    if (cmdResult.code === 0 || cmdResult.code === 1) {
      logger.success('Basic execution works')
    } else {
      logger.warn(`Unexpected exit code: ${cmdResult.code}`)
    }
  } catch (e) {
    logger.warn(`Basic execution warning: ${e.message}`)
  }

  logger.logNewline()
  logger.log('━'.repeat(60))
  logger.logNewline()

  logger.success('pkg workflow test completed successfully!')
  logger.logNewline()

  logger.log('📊 Summary:')
  logger.log(`   Custom Node: ${NODE_VERSION}`)
  logger.log(`   Executable: ${PKG_BINARY}`)
  logger.log(`   Size: ${size}`)
  logger.log(`   Location: ${PKG_BINARY_PATH}`)
  logger.logNewline()

  logger.log('✅ The custom Node.js binary works correctly with pkg!')
  logger.logNewline()
}

main().catch(e => {
  logger.fail(`Workflow test failed: ${e.message}`)
  logger.error(e.stack)
  process.exit(1)
})
