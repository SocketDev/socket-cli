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

import { getDefaultLogger } from '@socketsecurity/lib/logger'
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
  getDefaultLogger().step(`Running ${label}...`)

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
    getDefaultLogger().success(`${label} passed in ${minutes}m ${seconds}s`)
    return { success: true, duration }
  }

  getDefaultLogger().fail(`${label} failed after ${minutes}m ${seconds}s`)
  return { success: false, duration }
}

/**
 * Verify custom Node binary exists.
 */
function verifyCustomNode() {
  getDefaultLogger().step('Verifying custom Node binary...')

  if (!existsSync(CUSTOM_NODE_PATH)) {
    getDefaultLogger().fail(`Custom Node binary not found: ${CUSTOM_NODE_PATH}`)
    getDefaultLogger().substep('Run: node packages/node-smol-builder/scripts/build.mjs')
    process.exit(1)
  }

  getDefaultLogger().success(`Custom Node binary found: ${CUSTOM_NODE_PATH}`)
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
  getDefaultLogger().log(`🧪 Testing Socket CLI with Custom Node.js ${NODE_VERSION}`)
  getDefaultLogger().logNewline()

  // Step 1: Verify custom Node exists.
  verifyCustomNode()

  // Step 2: Check versions.
  getDefaultLogger().step('Checking Node versions...')
  const customVersion = await getNodeVersion(CUSTOM_NODE_PATH, true)
  const systemVersion = await getNodeVersion('node', false)

  getDefaultLogger().success(`Custom Node: ${customVersion}`)
  getDefaultLogger().success(`System Node: ${systemVersion}`)
  getDefaultLogger().logNewline()

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

  getDefaultLogger().step(`Test mode: ${testLabel}`)
  getDefaultLogger().substep(`Files: ${testFiles.length || 'all'}`)
  getDefaultLogger().logNewline()

  // Run with custom Node.
  const customResult = await runTests(
    CUSTOM_NODE_PATH,
    testFiles,
    `${testLabel} (Custom Node)`,
    true,
  )

  // Compare mode: also run with system Node.
  if (COMPARE_MODE) {
    getDefaultLogger().logNewline()
    const systemResult = await runTests(
      'node',
      testFiles,
      `${testLabel} (System Node)`,
      false,
    )

    getDefaultLogger().logNewline()
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().step('Comparison Summary')

    if (customResult.success && systemResult.success) {
      getDefaultLogger().success('Both Node versions passed all tests')
      const diff = customResult.duration - systemResult.duration
      const pct = ((diff / systemResult.duration) * 100).toFixed(1)
      if (Math.abs(diff) < 1000) {
        getDefaultLogger().info('Performance: Similar (within 1 second)')
      } else if (diff > 0) {
        getDefaultLogger().warn(`Performance: Custom Node ${pct}% slower`)
      } else {
        getDefaultLogger().success(`Performance: Custom Node ${Math.abs(pct)}% faster`)
      }
    } else if (customResult.success && !systemResult.success) {
      getDefaultLogger().success('Custom Node passed, System Node failed (!)')
    } else if (!customResult.success && systemResult.success) {
      getDefaultLogger().fail('Custom Node failed, System Node passed')
      getDefaultLogger().substep('Custom Node binary may have issues')
    } else {
      getDefaultLogger().fail('Both Node versions failed')
    }
  }

  getDefaultLogger().logNewline()
  getDefaultLogger().log('━'.repeat(60))
  getDefaultLogger().logNewline()

  if (customResult.success) {
    getDefaultLogger().success('Custom Node binary works correctly with Socket CLI!')
    getDefaultLogger().logNewline()
    process.exit(0)
  }

  getDefaultLogger().fail('Custom Node binary has issues')
  getDefaultLogger().substep('Review test output above for details')
  getDefaultLogger().substep(
    'Consider rebuilding: node packages/node-smol-builder/scripts/build.mjs --clean',
  )
  getDefaultLogger().logNewline()
  process.exit(1)
}

main().catch(e => {
  getDefaultLogger().fail(`Test script failed: ${e.message}`)
  getDefaultLogger().error(e.stack)
  process.exit(1)
})
