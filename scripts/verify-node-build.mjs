/**
 * @fileoverview Verify Socket Node.js build was successful and correct
 *
 * This script verifies that:
 * 1. Node binary was built successfully
 * 2. Socket modifications were applied correctly
 * 3. Binary size is reasonable
 * 4. Binary is functional
 * 5. Binary is in pkg cache
 *
 * Usage:
 *   node scripts/verify-node-build.mjs [--node-version v24.10.0]
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const versionArg = args.find(arg => arg.startsWith('--node-version='))
const NODE_VERSION = versionArg ? versionArg.split('=')[1] : 'v24.10.0'

const ROOT_DIR = join(__dirname, '..')
const BUILD_DIR = join(ROOT_DIR, '.custom-node-build')
const NODE_DIR = join(BUILD_DIR, 'node-yao-pkg')
const ARCH = process.arch
const IS_MACOS = platform() === 'darwin'

let hasErrors = false
let hasWarnings = false

/**
 * Execute a command and capture output
 */
async function execCapture(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

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
 * Log error.
 */
function error(message) {
  logger.error(`${colors.red('✗')} ${message}`)
  hasErrors = true
}

/**
 * Log warning.
 */
function warn(message) {
  logger.warn(`${colors.yellow('⚠')}  ${message}`)
  hasWarnings = true
}

/**
 * Log success.
 */
function success(message) {
  logger.log(`${colors.green('✓')} ${message}`)
}

/**
 * Log info.
 */
function info(message) {
  logger.log(`ℹ️  ${message}`)
}

/**
 * Verify Node.js source directory exists.
 */
function verifyNodeSourceExists() {
  info('Checking Node.js source directory...')
  if (!existsSync(NODE_DIR)) {
    error(`Node.js source directory not found: ${NODE_DIR}`)
    error('Run: node scripts/build-yao-pkg-node.mjs')
    return false
  }
  success('Node.js source directory exists')
  return true
}

/**
 * Verify Socket modifications were applied to lib/sea.js.
 */
async function verifySeaModification() {
  info('Verifying lib/sea.js modification...')

  const seaFile = join(NODE_DIR, 'lib', 'sea.js')
  if (!existsSync(seaFile)) {
    error('lib/sea.js not found')
    return false
  }

  const content = await readFile(seaFile, 'utf8')

  // Check for our modification.
  const hasCorrectModification = content.includes('const isSea = () => true;')

  // Check if it still has the original import.
  const hasOriginalImport = content.includes(
    "const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');",
  )

  if (!hasCorrectModification) {
    error('lib/sea.js is NOT modified correctly')
    error('Expected: const isSea = () => true;')
    error('This is CRITICAL - pkg binaries will not detect as SEA!')
    error('Run: node scripts/build-yao-pkg-node.mjs --clean')
    return false
  }

  if (hasOriginalImport) {
    error('lib/sea.js still has original isSea import')
    error('Socket modification was not applied correctly')
    error('Run: node scripts/build-yao-pkg-node.mjs --clean')
    return false
  }

  success('lib/sea.js correctly modified (isSea override applied)')
  return true
}

/**
 * Verify V8 include path fixes were applied (version-aware).
 */
async function verifyV8IncludeFixes() {
  info('Verifying V8 include paths...')

  // Parse version to determine expected behavior.
  const versionMatch = NODE_VERSION.match(/^v(\d+)\.(\d+)\.(\d+)/)
  if (!versionMatch) {
    warn('Could not parse Node version, skipping V8 include checks')
    return true
  }

  const major = Number.parseInt(versionMatch[1], 10)
  const minor = Number.parseInt(versionMatch[2], 10)

  // Determine if this version needs V8 include fixes.
  // v24.10.0+ does NOT need fixes (already has correct paths with "src/" prefix).
  // v24.9.0 and earlier DO need fixes (must remove "src/" prefix).
  const needsV8Fixes = major < 24 || (major === 24 && minor < 10)

  if (!needsV8Fixes) {
    info(
      'Node.js v24.10.0+ detected - V8 includes should have "src/" prefix (no fixes needed)',
    )
  } else {
    info(
      'Node.js v24.9.0 or earlier detected - V8 includes should NOT have "src/" prefix (fixes required)',
    )
  }

  const fixes = [
    {
      file: 'deps/v8/src/ast/ast-value-factory.h',
      includeWithoutPrefix: '#include "base/hashmap.h"',
      includeWithPrefix: '#include "src/base/hashmap.h"',
    },
    {
      file: 'deps/v8/src/heap/new-spaces-inl.h',
      includeWithoutPrefix: '#include "heap/spaces-inl.h"',
      includeWithPrefix: '#include "src/heap/spaces-inl.h"',
    },
    {
      file: 'deps/v8/src/heap/factory-inl.h',
      includeWithoutPrefix: '#include "heap/factory-base-inl.h"',
      includeWithPrefix: '#include "src/heap/factory-base-inl.h"',
    },
    {
      file: 'deps/v8/src/objects/js-objects-inl.h',
      includeWithoutPrefix: '#include "objects/hash-table-inl.h"',
      includeWithPrefix: '#include "src/objects/hash-table-inl.h"',
    },
    {
      file: 'deps/v8/src/heap/cppgc/heap-page.h',
      includeWithoutPrefix: '#include "base/iterator.h"',
      includeWithPrefix: '#include "src/base/iterator.h"',
    },
  ]

  let allCorrect = true

  for (const { file, includeWithPrefix, includeWithoutPrefix } of fixes) {
    const filePath = join(NODE_DIR, file)
    if (!existsSync(filePath)) {
      warn(`V8 file not found (may be version-specific): ${file}`)
      continue
    }

    const content = await readFile(filePath, 'utf8')

    if (needsV8Fixes) {
      // For v24.9.0 and earlier: Check that "src/" prefix is REMOVED.
      if (content.includes(includeWithPrefix)) {
        error(`${file} still has "src/" prefix: ${includeWithPrefix}`)
        error('V8 include fix was not applied')
        allCorrect = false
      } else if (content.includes(includeWithoutPrefix)) {
        success(`${file} correctly fixed (no "src/" prefix)`)
      } else {
        warn(
          `${file} has neither expected include format (may have changed in this Node version)`,
        )
      }
    } else {
      // For v24.10.0+: Check that "src/" prefix is PRESENT.
      if (content.includes(includeWithoutPrefix)) {
        error(`${file} has "src/" prefix removed: ${includeWithoutPrefix}`)
        error('V8 includes should NOT be modified for v24.10.0+')
        allCorrect = false
      } else if (content.includes(includeWithPrefix)) {
        success(`${file} correctly left unchanged (has "src/" prefix)`)
      } else {
        warn(
          `${file} has neither expected include format (may have changed in this Node version)`,
        )
      }
    }
  }

  if (!allCorrect) {
    error('V8 include paths are incorrect for this Node.js version!')
    error('Run: node scripts/build-yao-pkg-node.mjs --clean')
    return false
  }

  return allCorrect
}

/**
 * Verify binary exists and has reasonable size.
 */
async function verifyBinary() {
  info('Verifying Node binary...')

  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')
  if (!existsSync(nodeBinary)) {
    error('Node binary not found at: out/Release/node')
    error('Build may have failed. Check build logs.')
    return false
  }

  success('Node binary exists')

  // Check size.
  const result = await execCapture('du', ['-h', nodeBinary])
  if (result.code !== 0) {
    warn('Could not check binary size')
    return true
  }

  const sizeStr = result.stdout.split('\t')[0]
  info(`Binary size: ${sizeStr}`)

  // Parse size (e.g., "54M" -> 54).
  const sizeMatch = sizeStr.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && (size < 40 || size > 80)) {
      warn(`Binary size (${sizeStr}) is outside expected range (40-80MB)`)
      warn('Expected ~54MB after stripping, ~82MB before stripping')
    } else if (unit === 'G') {
      error(`Binary size (${sizeStr}) is too large!`)
      error('Something went wrong during build')
      return false
    } else if (unit === 'M' && size >= 40 && size <= 80) {
      success(`Binary size (${sizeStr}) is within expected range`)
    }
  }

  return true
}

/**
 * Test binary functionality.
 */
async function testBinary() {
  info('Testing binary functionality...')

  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')
  if (!existsSync(nodeBinary)) {
    return false
  }

  // Test 1: Version check.
  // For yao-pkg patched binaries, set PKG_EXECPATH to empty string to run as regular Node.js
  // See: https://github.com/yao-pkg/pkg#detect-if-the-app-is-running-as-packaged
  const versionResult = await execCapture(nodeBinary, ['--version'], {
    env: { ...process.env, PKG_EXECPATH: '' },
  })

  if (versionResult.code !== 0) {
    error('Binary failed version check')
    error(versionResult.stderr)
    return false
  }

  const version = versionResult.stdout
  if (!version.startsWith('v')) {
    error(`Binary version output unexpected: ${version}`)
    return false
  }

  success(`Binary version: ${version}`)

  // Test 2: Execute simple script.
  const execResult = await execCapture(
    nodeBinary,
    ['-e', 'logger.log("OK")'],
    {
      env: { ...process.env, PKG_EXECPATH: '' },
    },
  )

  if (execResult.code !== 0 || execResult.stdout !== 'OK') {
    error('Binary failed to execute simple script')
    error(execResult.stderr)
    return false
  }

  success('Binary can execute JavaScript')

  // Test 3: SEA detection.
  const seaScript = `
    const sea = require('node:sea');
    logger.log(sea.isSea() ? 'SEA_YES' : 'SEA_NO');
  `

  const seaResult = await execCapture(nodeBinary, ['-e', seaScript], {
    env: { ...process.env, PKG_EXECPATH: '' },
  })

  if (seaResult.code !== 0) {
    error('Binary failed SEA detection test')
    error(seaResult.stderr)
    return false
  }

  if (seaResult.stdout === 'SEA_YES') {
    success('Binary correctly reports as SEA (isSea() returns true)')
  } else if (seaResult.stdout === 'SEA_NO') {
    error('Binary reports isSea() = false - Socket modification not applied!')
    error('This is CRITICAL - pkg binaries will not work correctly')
    error('Run: node scripts/build-yao-pkg-node.mjs --clean')
    return false
  } else {
    error(`SEA detection returned unexpected output: ${seaResult.stdout}`)
    return false
  }

  return true
}

/**
 * Verify binary is in pkg cache.
 */
function verifyPkgCache() {
  info('Verifying pkg cache installation...')

  const pkgCacheDir = join(
    process.env.HOME || process.env.USERPROFILE,
    '.pkg-cache',
    'v3.5',
  )
  const targetName = `built-${NODE_VERSION}-${platform()}-${ARCH}${IS_MACOS && ARCH === 'arm64' ? '-signed' : ''}`
  const targetPath = join(pkgCacheDir, targetName)

  if (!existsSync(targetPath)) {
    error(`Binary not found in pkg cache: ${targetPath}`)
    error('Run the build script to copy binary to cache')
    return false
  }

  success(`Binary installed in pkg cache: ${targetPath}`)
  return true
}

/**
 * Verify macOS code signature.
 */
async function verifySignature() {
  if (!IS_MACOS) {
    return true
  }

  info('Verifying macOS code signature...')

  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')
  if (!existsSync(nodeBinary)) {
    return false
  }

  const result = await execCapture('codesign', ['-dv', nodeBinary])

  if (result.code !== 0) {
    warn('Binary is not signed (may cause issues on macOS)')
    warn('Run: codesign --sign - --force out/Release/node')
    return true // Not fatal.
  }

  success('Binary is properly signed for macOS')
  return true
}

/**
 * Main verification function.
 */
async function main() {
  logger.log(`🔍 Verifying Socket Node.js ${NODE_VERSION} Build`)
  logger.log('')

  // Run all verifications.
  const checks = [
    ['Node.js source exists', verifyNodeSourceExists],
    ['lib/sea.js modification', verifySeaModification],
    ['V8 include path fixes', verifyV8IncludeFixes],
    ['Binary exists and size', verifyBinary],
    ['Binary functionality', testBinary],
    ['pkg cache installation', verifyPkgCache],
    ['macOS signature', verifySignature],
  ]

  for (const [_name, check] of checks) {
    logger.log('')
    const result = await check()
    if (!result) {
      // Continue checking other items even if one fails.
    }
  }

  // Summary.
  logger.log('')
  logger.log('━'.repeat(60))
  logger.log('')

  if (hasErrors) {
    logger.error(`${colors.red('✗')} VERIFICATION FAILED`)
    logger.error('')
    logger.error(
      'Critical issues were found. Please fix them before using this build.',
    )
    logger.error('')
    logger.error('To rebuild:')
    logger.error('  node scripts/build-yao-pkg-node.mjs')
    logger.error('')
    process.exitCode = 1
  } else if (hasWarnings) {
    logger.warn(`${colors.yellow('⚠')}  VERIFICATION PASSED WITH WARNINGS`)
    logger.warn('')
    logger.warn('Build is functional but has non-critical issues.')
    logger.warn('')
  } else {
    logger.log(`${colors.green('✓')} ALL VERIFICATIONS PASSED`)
    logger.log('')
    logger.log('Node.js binary is correctly built and ready for use with pkg.')
    logger.log('')
  }
}

// Run main function.
main().catch(e => {
  logger.error(`${colors.red('✗')} Verification failed:`, e.message)
  process.exitCode = 1
})
