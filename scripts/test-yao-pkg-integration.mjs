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

import { spawn } from '@socketsecurity/registry/lib/spawn'

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

  console.log(`$ ${command} ${args.join(' ')}`)

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
  console.log()
  console.log('🧪 Socket CLI - yao-pkg Integration Test')
  console.log(`   Testing Node.js ${NODE_VERSION} binary with pkg`)
  console.log()

  let testsFailed = 0
  const testResults = []

  try {
    // Test 1: Verify custom Node.js binary exists in cache.
    console.log('━'.repeat(60))
    console.log('TEST 1: Custom Node.js Binary in Cache')
    console.log('━'.repeat(60))
    console.log()

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
      console.error(`❌ Custom Node.js binary not found: ${binaryPath}`)
      console.error('   Run: node scripts/build-yao-pkg-node.mjs')
      testsFailed++
      testResults.push({ name: 'Binary in cache', passed: false })
    } else {
      console.log(`✅ Custom Node.js binary found: ${binaryPath}`)
      testResults.push({ name: 'Binary in cache', passed: true })
    }

    console.log()

    // Test 2: Build Socket CLI.
    console.log('━'.repeat(60))
    console.log('TEST 2: Build Socket CLI')
    console.log('━'.repeat(60))
    console.log()

    console.log('Building Socket CLI distribution...')
    const buildResult = await exec('pnpm', ['run', 'build:dist:src'], {
      cwd: ROOT_DIR,
    })

    if (buildResult.code !== 0) {
      console.error('❌ Socket CLI build failed')
      console.error(buildResult.stderr)
      testsFailed++
      testResults.push({ name: 'Build Socket CLI', passed: false })
      throw new Error('Socket CLI build failed')
    }

    console.log('✅ Socket CLI built successfully')
    testResults.push({ name: 'Build Socket CLI', passed: true })
    console.log()

    // Test 3: Create test directory.
    console.log('━'.repeat(60))
    console.log('TEST 3: Setup Test Environment')
    console.log('━'.repeat(60))
    console.log()

    await mkdir(TEST_DIR, { recursive: true })
    console.log(`Created test directory: ${TEST_DIR}`)

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
console.log('Test executable running!');

// Test 2: SEA detection.
const isSea = sea.isSea();
console.log('SEA detection:', isSea ? 'YES' : 'NO');

// Test 3: File system access.
const cwd = process.cwd();
console.log('CWD:', cwd);

// Test 4: Module loading.
const pathModule = require('node:path');
console.log('Path module:', pathModule ? 'OK' : 'FAIL');

// Exit with appropriate code.
if (isSea) {
  console.log('✅ All tests passed');
  process.exit(0);
} else {
  console.error('❌ SEA detection failed');
  process.exit(1);
}
`

    await writeFile(join(TEST_DIR, 'test-cli.js'), testCliScript)
    console.log('✅ Test environment setup complete')
    testResults.push({ name: 'Setup test environment', passed: true })
    console.log()

    // Test 4: Create pkg executable.
    console.log('━'.repeat(60))
    console.log('TEST 4: Create pkg Executable')
    console.log('━'.repeat(60))
    console.log()

    console.log('Running pkg to create executable...')
    console.log(`Using custom Node.js binary: ${targetName}`)
    console.log()

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
      console.error('❌ pkg failed to create executable')
      console.error(pkgResult.stderr)
      testsFailed++
      testResults.push({ name: 'Create pkg executable', passed: false })
      throw new Error('pkg failed')
    }

    const executablePath = join(
      TEST_DIR,
      `socket-test${platform === 'win32' ? '.exe' : ''}`,
    )
    if (!existsSync(executablePath)) {
      console.error(`❌ Executable not created: ${executablePath}`)
      testsFailed++
      testResults.push({ name: 'Create pkg executable', passed: false })
      throw new Error('Executable not created')
    }

    console.log(`✅ Executable created: ${executablePath}`)
    testResults.push({ name: 'Create pkg executable', passed: true })
    console.log()

    // Test 5: Run the executable.
    console.log('━'.repeat(60))
    console.log('TEST 5: Run and Verify Executable')
    console.log('━'.repeat(60))
    console.log()

    console.log('Executing test binary...')
    console.log()

    const execResult = await exec(executablePath, [], {
      cwd: TEST_DIR,
    })

    console.log('Output:')
    console.log(execResult.stdout)
    console.log()

    if (execResult.code !== 0) {
      console.error('❌ Executable failed with exit code:', execResult.code)
      console.error('STDERR:', execResult.stderr)
      testsFailed++
      testResults.push({ name: 'Run executable', passed: false })
      testResults.push({ name: 'SEA detection', passed: false })
    } else {
      console.log('✅ Executable ran successfully')
      testResults.push({ name: 'Run executable', passed: true })

      // Verify SEA detection.
      if (execResult.stdout.includes('SEA detection: YES')) {
        console.log('✅ SEA detection working correctly')
        testResults.push({ name: 'SEA detection', passed: true })
      } else {
        console.error('❌ SEA detection failed (reported as NO)')
        testsFailed++
        testResults.push({ name: 'SEA detection', passed: false })
      }
    }

    console.log()

    // Summary.
    console.log('━'.repeat(60))
    console.log('TEST SUMMARY')
    console.log('━'.repeat(60))
    console.log()

    for (const { name, passed } of testResults) {
      console.log(`${passed ? '✅' : '❌'} ${name}`)
    }

    console.log()

    if (testsFailed === 0) {
      console.log('🎉 ALL TESTS PASSED')
      console.log()
      console.log('Your custom Node.js binary is working correctly with pkg!')
      console.log()
    } else {
      console.error(`❌ ${testsFailed} TEST(S) FAILED`)
      console.error()
      console.error('The custom Node.js binary has issues.')
      console.error('Review the errors above and rebuild:')
      console.error('  node scripts/build-yao-pkg-node.mjs --clean')
      console.error()
      process.exitCode = 1
    }
  } catch (e) {
    console.error()
    console.error('❌ Integration test failed:', e.message)
    console.error()
    process.exitCode = 1
  } finally {
    // Cleanup.
    console.log('━'.repeat(60))
    console.log('CLEANUP')
    console.log('━'.repeat(60))
    console.log()

    console.log(`Removing test directory: ${TEST_DIR}`)
    try {
      await rm(TEST_DIR, { recursive: true, force: true })
      console.log('✅ Test directory cleaned up')
    } catch (e) {
      console.warn(`⚠️  Could not clean up test directory: ${e.message}`)
      console.warn(`   Manually remove: rm -rf ${TEST_DIR}`)
    }

    console.log()
  }
}

// Run main function.
main().catch(error => {
  console.error('❌ Integration test crashed:', error.message)
  process.exitCode = 1
})
