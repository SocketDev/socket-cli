/**
 * @fileoverview End-to-end integration test for yao-pkg Node.js binary
 *
 * This script performs a complete end-to-end test:
 * 1. Builds Socket CLI with the custom Node.js binary
 * 2. Creates a pkg executable
 * 3. Tests the executable works correctly
 * 4. Verifies SEA detection
 * 5. Cleans up test artifacts
 *
 * Usage:
 *   node scripts/test-yao-pkg-integration.mjs [--node-version v24.10.0]
 */

import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const versionArg = args.find(arg => arg.startsWith('--node-version='))
const NODE_VERSION = versionArg ? versionArg.split('=')[1] : 'v24.10.0'

const ROOT_DIR = join(__dirname, '..')
const TEST_DIR = join(tmpdir(), `socket-cli-integration-test-${Date.now()}`)

/**
 * Execute a command and capture output.
 */
async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  logger.log(`$ ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    cwd,
    env,
    stdio: 'pipe',
    shell: false,
  })

  return {
    code: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

/**
 * Main test function.
 */
async function main() {
  logger.log()
  logger.log('🧪 Socket CLI - yao-pkg Integration Test')
  logger.log(`   Testing Node.js ${NODE_VERSION} binary with pkg`)
  logger.log()

  let testsFailed = 0
  const testResults = []

  try {
    // Test 1: Verify custom Node.js binary exists in cache.
    logger.log('━'.repeat(60))
    logger.log('TEST 1: Custom Node.js Binary in Cache')
    logger.log('━'.repeat(60))
    logger.log()

    const platform = process.platform
    const arch = process.arch
    const isMacOS = platform === 'darwin'
    const targetName = `built-${NODE_VERSION}-${platform}-${arch}${isMacOS && arch === 'arm64' ? '-signed' : ''}`
    const binaryPath = join(
      process.env.HOME || process.env.USERPROFILE,
      '.pkg-cache',
      'v3.5',
      targetName,
    )

    if (!existsSync(binaryPath)) {
      logger.error(`${colors.red('✗')} Custom Node.js binary not found: ${binaryPath}`)
      logger.error('   Run: node scripts/build-yao-pkg-node.mjs')
      testsFailed++
      testResults.push({ name: 'Binary in cache', passed: false })
    } else {
      logger.log(`${colors.green('✓')} Custom Node.js binary found: ${binaryPath}`)
      testResults.push({ name: 'Binary in cache', passed: true })
    }

    logger.log()

    // Test 2: Build Socket CLI.
    logger.log('━'.repeat(60))
    logger.log('TEST 2: Build Socket CLI')
    logger.log('━'.repeat(60))
    logger.log()

    logger.log('Building Socket CLI distribution...')
    const buildResult = await exec('pnpm', ['run', 'build:dist:src'], {
      cwd: ROOT_DIR,
    })

    if (buildResult.code !== 0) {
      logger.error(`${colors.red('✗')} Socket CLI build failed`)
      logger.error(buildResult.stderr)
      testsFailed++
      testResults.push({ name: 'Build Socket CLI', passed: false })
      throw new Error('Socket CLI build failed')
    }

    logger.log(`${colors.green('✓')} Socket CLI built successfully`)
    testResults.push({ name: 'Build Socket CLI', passed: true })
    logger.log()

    // Test 3: Create test directory.
    logger.log('━'.repeat(60))
    logger.log('TEST 3: Setup Test Environment')
    logger.log('━'.repeat(60))
    logger.log()

    await mkdir(TEST_DIR, { recursive: true })
    logger.log(`Created test directory: ${TEST_DIR}`)

    // Create minimal test package.json.
    const testPackageJson = {
      name: 'socket-cli-test',
      version: '1.0.0',
      main: 'test-cli.js',
      bin: {
        'socket-test': 'test-cli.js',
      },
    }

    await writeFile(
      join(TEST_DIR, 'package.json'),
      JSON.stringify(testPackageJson, null, 2),
    )

    // Create test CLI script.
    const testCliScript = `#!/usr/bin/env node
const sea = require('node:sea');
const fs = require('node:fs');
const path = require('node:path');

// Test 1: Basic execution.
logger.log('Test executable running!');

// Test 2: SEA detection.
const isSea = sea.isSea();
logger.log('SEA detection:', isSea ? 'YES' : 'NO');

// Test 3: File system access.
const cwd = process.cwd();
logger.log('CWD:', cwd);

// Test 4: Module loading.
const pathModule = require('node:path');
logger.log('Path module:', pathModule ? 'OK' : 'FAIL');

// Exit with appropriate code.
if (isSea) {
  logger.log(`${colors.green('✓')} All tests passed`);
  process.exit(0);
} else {
  logger.error(`${colors.red('✗')} SEA detection failed`);
  process.exit(1);
}
`

    await writeFile(join(TEST_DIR, 'test-cli.js'), testCliScript)
    logger.log(`${colors.green('✓')} Test environment setup complete`)
    testResults.push({ name: 'Setup test environment', passed: true })
    logger.log()

    // Test 4: Create pkg executable.
    logger.log('━'.repeat(60))
    logger.log('TEST 4: Create pkg Executable')
    logger.log('━'.repeat(60))
    logger.log()

    logger.log('Running pkg to create executable...')
    logger.log(`Using custom Node.js binary: ${targetName}`)
    logger.log()

    const pkgResult = await exec(
      'pnpm',
      [
        'exec',
        'pkg',
        '.',
        '--targets',
        `node24-${platform}-${arch}`,
        '--output',
        'socket-test',
      ],
      {
        cwd: TEST_DIR,
      },
    )

    if (pkgResult.code !== 0) {
      logger.error(`${colors.red('✗')} pkg failed to create executable`)
      logger.error(pkgResult.stderr)
      testsFailed++
      testResults.push({ name: 'Create pkg executable', passed: false })
      throw new Error('pkg failed')
    }

    const executablePath = join(
      TEST_DIR,
      `socket-test${platform === 'win32' ? '.exe' : ''}`,
    )
    if (!existsSync(executablePath)) {
      logger.error(`${colors.red('✗')} Executable not created: ${executablePath}`)
      testsFailed++
      testResults.push({ name: 'Create pkg executable', passed: false })
      throw new Error('Executable not created')
    }

    logger.log(`${colors.green('✓')} Executable created: ${executablePath}`)
    testResults.push({ name: 'Create pkg executable', passed: true })
    logger.log()

    // Test 5: Run the executable.
    logger.log('━'.repeat(60))
    logger.log('TEST 5: Run and Verify Executable')
    logger.log('━'.repeat(60))
    logger.log()

    logger.log('Executing test binary...')
    logger.log()

    const execResult = await exec(executablePath, [], {
      cwd: TEST_DIR,
    })

    logger.log('Output:')
    logger.log(execResult.stdout)
    logger.log()

    if (execResult.code !== 0) {
      logger.error(`${colors.red('✗')} Executable failed with exit code:`, execResult.code)
      logger.error('STDERR:', execResult.stderr)
      testsFailed++
      testResults.push({ name: 'Run executable', passed: false })
      testResults.push({ name: 'SEA detection', passed: false })
    } else {
      logger.log(`${colors.green('✓')} Executable ran successfully`)
      testResults.push({ name: 'Run executable', passed: true })

      // Verify SEA detection.
      if (execResult.stdout.includes('SEA detection: YES')) {
        logger.log(`${colors.green('✓')} SEA detection working correctly`)
        testResults.push({ name: 'SEA detection', passed: true })
      } else {
        logger.error(`${colors.red('✗')} SEA detection failed (reported as NO)`)
        testsFailed++
        testResults.push({ name: 'SEA detection', passed: false })
      }
    }

    logger.log()

    // Summary.
    logger.log('━'.repeat(60))
    logger.log('TEST SUMMARY')
    logger.log('━'.repeat(60))
    logger.log()

    for (const { name, passed } of testResults) {
      logger.log(`${passed ? `${colors.green('✓')}` : `${colors.red('✗')}`} ${name}`)
    }

    logger.log()

    if (testsFailed === 0) {
      logger.log('🎉 ALL TESTS PASSED')
      logger.log()
      logger.log('Your custom Node.js binary is working correctly with pkg!')
      logger.log()
    } else {
      logger.error(`${colors.red('✗')} ${testsFailed} TEST(S) FAILED`)
      logger.error()
      logger.error('The custom Node.js binary has issues.')
      logger.error('Review the errors above and rebuild:')
      logger.error('  node scripts/build-yao-pkg-node.mjs --clean')
      logger.error()
      process.exitCode = 1
    }
    logger.error()
  } catch (e) {
    logger.error(`${colors.red('✗')} Integration test failed:`, e.message)
    logger.error()
    process.exitCode = 1
  } finally {
    // Cleanup.
    logger.log('━'.repeat(60))
    logger.log('CLEANUP')
    logger.log('━'.repeat(60))
    logger.log()

    logger.log(`Removing test directory: ${TEST_DIR}`)
    try {
      await rm(TEST_DIR, { recursive: true, force: true })
      logger.log(`${colors.green('✓')} Test directory cleaned up`)
    } catch (e) {
      logger.warn(`${colors.yellow('⚠')}  Could not clean up test directory: ${e.message}`)
      logger.warn(`   Manually remove: rm -rf ${TEST_DIR}`)
    }

    logger.log()
  }
}

// Run main function.
main().catch(error => {
  logger.error(`${colors.red('✗')} Integration test crashed:`, error.message)
  process.exitCode = 1
})
