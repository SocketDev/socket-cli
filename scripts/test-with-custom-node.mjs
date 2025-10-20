/**
 * @fileoverview Test Socket CLI with custom Node.js build
 *
 * This script validates that the custom Node.js binary works correctly
 * with Socket CLI by running a subset of tests.
 *
 * Usage:
 *   node scripts/test-with-custom-node.mjs                    # Run smoke tests
 *   node scripts/test-with-custom-node.mjs --full             # Run full test suite
 *   node scripts/test-with-custom-node.mjs --compare          # Compare with system Node
 *   node scripts/test-with-custom-node.mjs --node-version v24.10.0
 */

import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '..')

// Parse arguments.
const args = process.argv.slice(2)
const versionArg = args.find(arg => arg.startsWith('--node-version='))
const NODE_VERSION = versionArg ? versionArg.split('=')[1] : 'v24.10.0'
const FULL_TESTS = args.includes('--full')
const COMPARE_MODE = args.includes('--compare')
const ARCH = process.arch
const IS_MACOS = platform() === 'darwin'

// Get custom Node binary path.
const pkgCacheDir = join(
  process.env.HOME || process.env.USERPROFILE,
  '.pkg-cache',
  'v3.5',
)
const targetName = `built-${NODE_VERSION}-${platform()}-${ARCH}${IS_MACOS && ARCH === 'arm64' ? '-signed' : ''}`
const CUSTOM_NODE_PATH = join(pkgCacheDir, targetName)

// Smoke tests: Critical tests that must pass.
const SMOKE_TESTS = [
  'src/cli.test.mts',
  'src/commands.test.mts',
  'src/constants.test.mts',
  'src/types.test.mts',
]

// Core tests: Important functionality.
const CORE_TESTS = [
  ...SMOKE_TESTS,
  'src/utils/config.test.mts',
  'src/utils/debug.test.mts',
  'src/shadow/common.test.mts',
]

/**
 * Execute command and capture output.
 */
async function execCapture(command, args = [], options = {}) {
  const { customNode = false, cwd = process.cwd(), env = process.env } = options

  // For custom Node binaries built with yao-pkg patches:
  // Set PKG_EXECPATH to empty string to run as regular Node.js
  // See: https://github.com/yao-pkg/pkg#detect-if-the-app-is-running-as-packaged
  const execEnv = customNode ? { ...env, PKG_EXECPATH: '' } : env

  const result = await spawn(command, args, {
    cwd,
    env: execEnv,
    stdio: 'pipe',
    shell: false,
  })

  return {
    code: result.code,
    stdout: result.stdout ? result.stdout.trim() : '',
    stderr: result.stderr ? result.stderr.trim() : '',
  }
}

/**
 * Run tests with specific Node binary.
 */
async function runTests(nodePath, testFiles, label, isCustomNode = false) {
  logger.step(`Running ${label}...`)

  const startTime = Date.now()

  // For custom Node binaries built with yao-pkg patches:
  // Set PKG_EXECPATH to empty string to run as regular Node.js
  // See: https://github.com/yao-pkg/pkg#detect-if-the-app-is-running-as-packaged
  const testEnv = isCustomNode
    ? {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=4096',
        PKG_EXECPATH: '',
      }
    : {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=4096',
      }

  // Run vitest using the specified Node binary
  // We need to run the vitest entry point directly, not the shell wrapper
  const vitestEntry = join(ROOT_DIR, 'node_modules', 'vitest', 'vitest.mjs')

  const result = await spawn(
    nodePath,
    [vitestEntry, 'run', ...testFiles, '--reporter=verbose'],
    {
      cwd: ROOT_DIR,
      env: testEnv,
      stdio: 'inherit',
    },
  )

  const duration = Date.now() - startTime
  const minutes = Math.floor(duration / 60_000)
  const seconds = Math.floor((duration % 60_000) / 1000)

  if (result.code === 0) {
    logger.success(`${label} passed in ${minutes}m ${seconds}s`)
    return { success: true, duration }
  }

  logger.fail(`${label} failed after ${minutes}m ${seconds}s`)
  return { success: false, duration }
}

/**
 * Verify custom Node binary exists.
 */
function verifyCustomNode() {
  logger.step('Verifying custom Node binary...')

  if (!existsSync(CUSTOM_NODE_PATH)) {
    logger.fail(`Custom Node binary not found: ${CUSTOM_NODE_PATH}`)
    logger.substep('Run: node scripts/build-yao-pkg-node.mjs')
    process.exit(1)
  }

  logger.success(`Custom Node binary found: ${CUSTOM_NODE_PATH}`)
  return true
}

/**
 * Get Node version.
 */
async function getNodeVersion(nodePath, isCustomNode = false) {
  const result = await execCapture(nodePath, ['--version'], {
    customNode: isCustomNode,
  })
  if (result.code === 0) {
    return result.stdout
  }
  return 'unknown'
}

/**
 * Main function.
 */
async function main() {
  logger.log(`🧪 Testing Socket CLI with Custom Node.js ${NODE_VERSION}`)
  logger.logNewline()

  // Step 1: Verify custom Node exists.
  verifyCustomNode()

  // Step 2: Check versions.
  logger.step('Checking Node versions...')
  const customVersion = await getNodeVersion(CUSTOM_NODE_PATH, true)
  const systemVersion = await getNodeVersion('node', false)

  logger.success(`Custom Node: ${customVersion}`)
  logger.success(`System Node: ${systemVersion}`)
  logger.logNewline()

  // Step 3: Run tests.
  let testFiles = SMOKE_TESTS
  let testLabel = 'Smoke Tests'

  if (FULL_TESTS) {
    // Run all tests.
    testFiles = []
    testLabel = 'Full Test Suite'
  } else if (args.length > 0 && !args.some(a => a.startsWith('--'))) {
    // Custom test files specified.
    testFiles = args.filter(a => !a.startsWith('--'))
    testLabel = 'Custom Tests'
  } else {
    // Default: core tests.
    testFiles = CORE_TESTS
    testLabel = 'Core Tests'
  }

  logger.step(`Test mode: ${testLabel}`)
  logger.substep(`Files: ${testFiles.length || 'all'}`)
  logger.logNewline()

  // Run with custom Node.
  const customResult = await runTests(
    CUSTOM_NODE_PATH,
    testFiles,
    `${testLabel} (Custom Node)`,
    true,
  )

  // Compare mode: also run with system Node.
  if (COMPARE_MODE) {
    logger.logNewline()
    const systemResult = await runTests(
      'node',
      testFiles,
      `${testLabel} (System Node)`,
      false,
    )

    logger.logNewline()
    logger.log('━'.repeat(60))
    logger.step('Comparison Summary')

    if (customResult.success && systemResult.success) {
      logger.success('Both Node versions passed all tests')
      const diff = customResult.duration - systemResult.duration
      const pct = ((diff / systemResult.duration) * 100).toFixed(1)
      if (Math.abs(diff) < 1000) {
        logger.info('Performance: Similar (within 1 second)')
      } else if (diff > 0) {
        logger.warn(`Performance: Custom Node ${pct}% slower`)
      } else {
        logger.success(`Performance: Custom Node ${Math.abs(pct)}% faster`)
      }
    } else if (customResult.success && !systemResult.success) {
      logger.success('Custom Node passed, System Node failed (!)')
    } else if (!customResult.success && systemResult.success) {
      logger.fail('Custom Node failed, System Node passed')
      logger.substep('Custom Node binary may have issues')
    } else {
      logger.fail('Both Node versions failed')
    }
  }

  logger.logNewline()
  logger.log('━'.repeat(60))
  logger.logNewline()

  if (customResult.success) {
    logger.success('Custom Node binary works correctly with Socket CLI!')
    logger.logNewline()
    process.exit(0)
  }

  logger.fail('Custom Node binary has issues')
  logger.substep('Review test output above for details')
  logger.substep(
    'Consider rebuilding: node scripts/build-yao-pkg-node.mjs --clean',
  )
  logger.logNewline()
  process.exit(1)
}

main().catch(e => {
  logger.fail(`Test script failed: ${e.message}`)
  logger.error(e.stack)
  process.exit(1)
})
