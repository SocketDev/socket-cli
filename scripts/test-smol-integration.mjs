/**
 * @fileoverview End-to-end integration test for smol Node.js binary
 *
 * This script performs a complete end-to-end test:
 * 1. Builds Socket CLI with the custom Node.js binary
 * 2. Creates a pkg executable
 * 3. Tests the executable works correctly
 * 4. Verifies SEA detection
 * 5. Cleans up test artifacts
 *
 * Usage:
 *   node scripts/test-smol-integration.mjs [--node-version v24.10.0]
 */

import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
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

  getDefaultLogger().log(`$ ${command} ${args.join(' ')}`)

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
  getDefaultLogger().log('')
  getDefaultLogger().log('🧪 Socket CLI - Smol Integration Test')
  getDefaultLogger().log(`   Testing Node.js ${NODE_VERSION} binary with pkg`)
  getDefaultLogger().log('')

  let testsFailed = 0
  const testResults = []

  try {
    // Test 1: Verify custom Node.js binary exists in cache.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('TEST 1: Custom Node.js Binary in Cache')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

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
      getDefaultLogger().error(`${colors.red('✗')} Custom Node.js binary not found: ${binaryPath}`)
      getDefaultLogger().error('   Run: node packages/node-smol-builder/scripts/build.mjs')
      testsFailed++
      testResults.push({ name: 'Binary in cache', passed: false })
    } else {
      getDefaultLogger().log(`${colors.green('✓')} Custom Node.js binary found: ${binaryPath}`)
      testResults.push({ name: 'Binary in cache', passed: true })
    }

    getDefaultLogger().log('')

    // Test 2: Build Socket CLI.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('TEST 2: Build Socket CLI')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

    getDefaultLogger().log('Building Socket CLI distribution...')
    const buildResult = await exec('pnpm', ['run', 'build:cli'], {
      cwd: ROOT_DIR,
    })

    if (buildResult.code !== 0) {
      getDefaultLogger().error(`${colors.red('✗')} Socket CLI build failed`)
      getDefaultLogger().error(buildResult.stderr)
      testsFailed++
      testResults.push({ name: 'Build Socket CLI', passed: false })
      throw new Error('Socket CLI build failed')
    }

    getDefaultLogger().log(`${colors.green('✓')} Socket CLI built successfully`)
    testResults.push({ name: 'Build Socket CLI', passed: true })
    getDefaultLogger().log('')

    // Test 3: Create test directory.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('TEST 3: Setup Test Environment')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

    await mkdir(TEST_DIR, { recursive: true })
    getDefaultLogger().log(`Created test directory: ${TEST_DIR}`)

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
getDefaultLogger().log('Test executable running!');

// Test 2: SEA detection.
const isSea = sea.isSea();
getDefaultLogger().log('SEA detection:', isSea ? 'YES' : 'NO');

// Test 3: File system access.
const cwd = process.cwd();
getDefaultLogger().log('CWD:', cwd);

// Test 4: Module loading.
const pathModule = require('node:path');
getDefaultLogger().log('Path module:', pathModule ? 'OK' : 'FAIL');

// Exit with appropriate code.
if (isSea) {
  getDefaultLogger().log(`${colors.green('✓')} All tests passed`);
  process.exit(0);
} else {
  getDefaultLogger().error(`${colors.red('✗')} SEA detection failed`);
  process.exit(1);
}
`

    await writeFile(join(TEST_DIR, 'test-cli.js'), testCliScript)
    getDefaultLogger().log(`${colors.green('✓')} Test environment setup complete`)
    testResults.push({ name: 'Setup test environment', passed: true })
    getDefaultLogger().log('')

    // Test 4: Create pkg executable.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('TEST 4: Create pkg Executable')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

    getDefaultLogger().log('Running pkg to create executable...')
    getDefaultLogger().log(`Using custom Node.js binary: ${targetName}`)
    getDefaultLogger().log('')

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
      getDefaultLogger().error(`${colors.red('✗')} pkg failed to create executable`)
      getDefaultLogger().error(pkgResult.stderr)
      testsFailed++
      testResults.push({ name: 'Create pkg executable', passed: false })
      throw new Error('pkg failed')
    }

    const executablePath = join(
      TEST_DIR,
      `socket-test${platform === 'win32' ? '.exe' : ''}`,
    )
    if (!existsSync(executablePath)) {
      getDefaultLogger().error(`${colors.red('✗')} Executable not created: ${executablePath}`)
      testsFailed++
      testResults.push({ name: 'Create pkg executable', passed: false })
      throw new Error('Executable not created')
    }

    getDefaultLogger().log(`${colors.green('✓')} Executable created: ${executablePath}`)
    testResults.push({ name: 'Create pkg executable', passed: true })
    getDefaultLogger().log('')

    // Test 5: Run the executable.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('TEST 5: Run and Verify Executable')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

    getDefaultLogger().log('Executing test binary...')
    getDefaultLogger().log('')

    const execResult = await exec(executablePath, [], {
      cwd: TEST_DIR,
    })

    getDefaultLogger().log('Output:')
    getDefaultLogger().log(execResult.stdout)
    getDefaultLogger().log('')

    if (execResult.code !== 0) {
      getDefaultLogger().error(`${colors.red('✗')} Executable failed with exit code:`, execResult.code)
      getDefaultLogger().error('STDERR:', execResult.stderr)
      testsFailed++
      testResults.push({ name: 'Run executable', passed: false })
      testResults.push({ name: 'SEA detection', passed: false })
    } else {
      getDefaultLogger().log(`${colors.green('✓')} Executable ran successfully`)
      testResults.push({ name: 'Run executable', passed: true })

      // Verify SEA detection.
      if (execResult.stdout.includes('SEA detection: YES')) {
        getDefaultLogger().log(`${colors.green('✓')} SEA detection working correctly`)
        testResults.push({ name: 'SEA detection', passed: true })
      } else {
        getDefaultLogger().error(`${colors.red('✗')} SEA detection failed (reported as NO)`)
        testsFailed++
        testResults.push({ name: 'SEA detection', passed: false })
      }
    }

    getDefaultLogger().log('')

    // Summary.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('TEST SUMMARY')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

    for (const { name, passed } of testResults) {
      getDefaultLogger().log(`${passed ? `${colors.green('✓')}` : `${colors.red('✗')}`} ${name}`)
    }

    getDefaultLogger().log('')

    if (testsFailed === 0) {
      getDefaultLogger().log('🎉 ALL TESTS PASSED')
      getDefaultLogger().log('')
      getDefaultLogger().log('Your custom Node.js binary is working correctly with pkg!')
      getDefaultLogger().log('')
    } else {
      getDefaultLogger().error(`${colors.red('✗')} ${testsFailed} TEST(S) FAILED`)
      getDefaultLogger().error()
      getDefaultLogger().error('The custom Node.js binary has issues.')
      getDefaultLogger().error('Review the errors above and rebuild:')
      getDefaultLogger().error('  node packages/node-smol-builder/scripts/build.mjs --clean')
      getDefaultLogger().error()
      process.exitCode = 1
    }
    getDefaultLogger().error()
  } catch (e) {
    getDefaultLogger().error(`${colors.red('✗')} Integration test failed:`, e.message)
    getDefaultLogger().error()
    process.exitCode = 1
  } finally {
    // Cleanup.
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('CLEANUP')
    getDefaultLogger().log('━'.repeat(60))
    getDefaultLogger().log('')

    getDefaultLogger().log(`Removing test directory: ${TEST_DIR}`)
    try {
      await rm(TEST_DIR, { recursive: true, force: true })
      getDefaultLogger().log(`${colors.green('✓')} Test directory cleaned up`)
    } catch (e) {
      getDefaultLogger().warn(`${colors.yellow('⚠')}  Could not clean up test directory: ${e.message}`)
      getDefaultLogger().warn(`   Manually remove: rm -rf ${TEST_DIR}`)
    }

    getDefaultLogger().log('')
  }
}

// Run main function.
main().catch(error => {
  getDefaultLogger().error(`${colors.red('✗')} Integration test crashed:`, error.message)
  process.exitCode = 1
})
