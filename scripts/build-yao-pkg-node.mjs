/**
 * @fileoverview Build custom Node.js v24.10.0 with yao-pkg patches
 *
 * This script produces a patched Node binary for use with @yao-pkg/pkg.
 * It downloads Node.js source, applies yao-pkg patches, configures with
 * size optimizations, and builds a custom binary.
 *
 * Usage:
 *   node scripts/build-yao-pkg-node.mjs              # Normal build
 *   node scripts/build-yao-pkg-node.mjs --clean      # Force fresh build
 *   node scripts/build-yao-pkg-node.mjs --verify     # Verify after build
 *   node scripts/build-yao-pkg-node.mjs --test       # Build + run smoke tests
 *   node scripts/build-yao-pkg-node.mjs --test-full  # Build + run full tests
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { cpus, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/registry/lib/logger'

import { downloadWithRetry, exec, execCapture } from './lib/build-exec.mjs'
import {
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
  cleanCheckpoint,
  createCheckpoint,
  estimateBuildTime,
  formatDuration,
  getBuildLogPath,
  getLastLogLines,
  saveBuildLog,
  smokeTestBinary,
  verifyFileIntegrity,
  verifyGitTag,
} from './lib/build-helpers.mjs'
import { printError, printHeader, printWarning } from './lib/build-output.mjs'
import {
  analyzePatchContent,
  checkPatchConflicts,
  testPatchApplication,
  validatePatch,
} from './lib/patch-validator.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const CLEAN_BUILD = args.includes('--clean')
const RUN_VERIFY = args.includes('--verify')
const RUN_TESTS = args.includes('--test')
const RUN_FULL_TESTS = args.includes('--test-full')

// Configuration
const NODE_VERSION = 'v24.10.0'
const ROOT_DIR = join(__dirname, '..')
const NODE_SOURCE_DIR = join(ROOT_DIR, '.node-source')
const NODE_DIR = NODE_SOURCE_DIR // Alias for compatibility.
const BUILD_DIR = join(ROOT_DIR, 'build')
const YAO_PATCHES_DIR = join(BUILD_DIR, 'patches', 'yao')
const SOCKET_PATCHES_DIR = join(BUILD_DIR, 'patches', 'socket')
const YAO_PATCH_FILE = join(YAO_PATCHES_DIR, `node.${NODE_VERSION}.cpp.patch`)
const YAO_PATCH_URL = `https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.${NODE_VERSION}.cpp.patch`

// Directory structure.
// .node-source/ - Node.js source code (gitignored).
// .node-source/out/Release/node - Node.js build output (gitignored).
// build/out/Release/node - Copy of Release binary (gitignored).
// build/out/Stripped/node - Stripped binary (gitignored).
// build/out/Signed/node - Stripped + signed binary (gitignored).
// build/out/Sea/node - Stripped + signed binary for SEA builds (gitignored).
// build/patches/yao/ - Yao-pkg patches (tracked in git).
// build/patches/socket/ - Socket patches (tracked in git).

/**
 * Find Socket patches for this Node version
 */
function findSocketPatches() {
  const versionString = NODE_VERSION.replace(/\./g, '-')

  // IMPORTANT: v24.10.0+ doesn't need V8 include path fixes
  // Only v24.9.0 and earlier needed those fixes
  // Warn if we find old patches with V8 fixes

  // Try versioned combined patch first
  const combinedPatch = `socket-node-modifications-${versionString}.patch`
  if (existsSync(join(SOCKET_PATCHES_DIR, combinedPatch))) {
    console.log(`   Found patch: ${combinedPatch}`)
    console.log(
      `   ⚠️  WARNING: Verify this patch is compatible with ${NODE_VERSION}`,
    )
    console.log('   ⚠️  v24.10.0+ should NOT have V8 include path fixes')
    console.log()
    return [combinedPatch]
  }

  // Fall back to individual patches
  const individualPatches = [
    `fix-v8-include-paths-${versionString}.patch`,
    `enable-sea-for-pkg-binaries-${versionString}.patch`,
  ]

  // Filter to only patches that exist
  const existingPatches = individualPatches.filter(patch =>
    existsSync(join(SOCKET_PATCHES_DIR, patch)),
  )

  if (existingPatches.length > 0) {
    console.log(`   Found ${existingPatches.length} individual patch(es)`)
    if (existingPatches.some(p => p.includes('fix-v8-include-paths'))) {
      console.log('   ⚠️  WARNING: V8 include path patch found')
      console.log(
        '   ⚠️  This patch is NOT needed for v24.10.0+ and may break the build',
      )
      console.log('   ⚠️  Consider using direct modifications instead')
      console.log()
    }
    return existingPatches
  }

  // Last resort: try generic v24 patches
  const genericPatches = [
    'fix-v8-include-paths-v24.patch',
    'enable-sea-for-pkg-binaries-v24.patch',
  ].filter(patch => existsSync(join(SOCKET_PATCHES_DIR, patch)))

  if (genericPatches.length > 0) {
    console.log(`   Found ${genericPatches.length} generic v24 patch(es)`)
    if (genericPatches.some(p => p.includes('fix-v8-include-paths'))) {
      printWarning(
        'Incompatible Patch Found',
        `Generic V8 include path patch exists but is NOT compatible with ${NODE_VERSION}`,
        [
          'Remove: build/patches/socket/fix-v8-include-paths-v24.patch',
          'Or rename to prevent automatic detection',
          'v24.10.0+ uses direct modifications without patches',
        ],
      )
      // Filter out V8 include patches for v24.10.0+
      return genericPatches.filter(p => !p.includes('fix-v8-include-paths'))
    }
    return genericPatches
  }

  return []
}

const CPU_COUNT = cpus().length
const IS_MACOS = platform() === 'darwin'
const ARCH = process.arch

/**
 * Get file size in human-readable format.
 */
async function getFileSize(filePath) {
  const result = await execCapture('du', ['-h', filePath])
  return result.split('\t')[0]
}

/**
 * Check if required tools are available.
 */
async function checkRequiredTools() {
  printHeader('Pre-flight Checks')

  const tools = [
    { name: 'git', cmd: 'git', args: ['--version'] },
    { name: 'curl', cmd: 'curl', args: ['--version'] },
    { name: 'patch', cmd: 'patch', args: ['--version'] },
    { name: 'make', cmd: 'make', args: ['--version'] },
    // macOS strip doesn't support --version, just check if it exists.
    { name: 'strip', cmd: 'strip', args: [], checkExists: true },
  ]

  if (IS_MACOS && ARCH === 'arm64') {
    // macOS codesign doesn't support --version, just check if it exists.
    tools.push({
      name: 'codesign',
      cmd: 'codesign',
      args: [],
      checkExists: true,
    })
  }

  let allAvailable = true

  for (const { args, checkExists, cmd, name } of tools) {
    try {
      if (checkExists) {
        // Just check if command exists (for tools that don't support --version).
        const result = await execCapture('which', [cmd])
        if (result.includes(cmd)) {
          console.log(`✅ ${name} is available`)
        } else {
          throw new Error('Not found')
        }
      } else {
        await execCapture(cmd, args)
        console.log(`✅ ${name} is available`)
      }
    } catch {
      console.error(`❌ ${name} is NOT available`)
      allAvailable = false
    }
  }

  if (!allAvailable) {
    printError(
      'Missing Required Tools',
      'Some required build tools are not available on your system.',
      [
        'Install missing tools using your package manager',
        'On macOS: xcode-select --install',
        'On macOS (Homebrew): brew install git curl',
        'On Linux: apt-get install git curl patch make binutils',
      ],
    )
    throw new Error('Missing required build tools')
  }

  logger.log('')
}

/**
 * Check build environment (Python, compiler, disk space, network).
 */
async function checkBuildEnvironment() {
  printHeader('Build Environment Checks')

  let allChecks = true

  // Check 1: Disk space.
  logger.log('Checking available disk space...')
  const diskSpace = await checkDiskSpace(BUILD_DIR)
  if (diskSpace.availableGB !== null) {
    if (diskSpace.sufficient) {
      logger.success(
        `Disk space: ${diskSpace.availableGB}GB available (need 5GB)`,
      )
    } else {
      logger.fail(
        `Disk space: Only ${diskSpace.availableGB}GB available (need 5GB)`,
      )
      logger.substep('Free up disk space before building')
      allChecks = false
    }
  } else {
    logger.warn('Could not check disk space (continuing anyway)')
  }

  // Check 2: Python version.
  logger.log('Checking Python version...')
  const python = await checkPythonVersion()
  if (python.available && python.sufficient) {
    logger.success(`Python ${python.version} is available`)
  } else if (python.available && !python.sufficient) {
    logger.fail(`Python ${python.version} is too old (need Python 3.6+)`)
    allChecks = false
  } else {
    logger.fail('Python is not available')
    logger.substep('Node.js build requires Python 3.6 or later')
    allChecks = false
  }

  // Check 3: C++ compiler.
  logger.log('Checking C++ compiler...')
  const compiler = await checkCompiler()
  if (compiler.available) {
    logger.success(`C++ compiler (${compiler.compiler}) is available`)
  } else {
    logger.fail('C++ compiler is not available')
    logger.substep('Node.js build requires clang++, g++, or c++')
    allChecks = false
  }

  // Check 4: Network connectivity.
  logger.log('Checking network connectivity...')
  const network = await checkNetworkConnectivity()
  if (network.connected) {
    logger.success('Network connection to GitHub is working')
  } else {
    logger.fail('Cannot reach GitHub')
    logger.substep('Check your internet connection')
    allChecks = false
  }

  logger.logNewline()

  if (!allChecks) {
    printError(
      'Build Environment Not Ready',
      'Some required build environment checks failed.',
      [
        'Fix the issues above before building',
        'Disk space: Free up space if needed',
        'Python: Install Python 3.6+ (python.org or brew install python)',
        'Compiler: Install Xcode Command Line Tools (xcode-select --install)',
        'Network: Check your internet connection',
      ],
    )
    throw new Error('Build environment checks failed')
  }

  logger.success('Build environment is ready')
  logger.logNewline()
}

/**
 * Check if yao-pkg patch is available.
 */
async function checkYaoPkgPatch() {
  printHeader('Checking yao-pkg Patch Availability')

  // Try to download patch to see if it exists.
  logger.log(`Checking for yao-pkg patch for ${NODE_VERSION}...`)
  logger.log(`URL: ${YAO_PATCH_URL}`)
  logger.log('')

  try {
    const result = await execCapture('curl', ['-sI', YAO_PATCH_URL])
    if (result.includes('404') || result.includes('Not Found')) {
      printWarning(
        'yao-pkg Patch Not Available',
        `The yao-pkg project has not released patches for ${NODE_VERSION} yet.`,
        [
          'Check https://github.com/yao-pkg/pkg-fetch/tree/main/patches for available versions',
          'Use a supported Node.js version (check yao-pkg releases)',
          `Wait for yao-pkg to release patches for ${NODE_VERSION}`,
          'Update NODE_VERSION in this script to a supported version',
        ],
      )
      return false
    }

    console.log(`✅ yao-pkg patch is available for ${NODE_VERSION}`)
    console.log()
    return true
  } catch {
    printWarning(
      'Cannot Check Patch Availability',
      'Unable to check if yao-pkg patch exists (network issue?).',
      [
        'Check your internet connection',
        'Try again in a moment',
        'Manually verify patch exists at: https://github.com/yao-pkg/pkg-fetch/tree/main/patches',
      ],
    )
    return false
  }
}

/**
 * Verify Socket modifications were applied correctly.
 */
async function verifySocketModifications() {
  printHeader('Verifying Socket Modifications')

  let allApplied = true

  // Check 1: lib/sea.js modification.
  logger.log('Checking lib/sea.js modification...')
  const seaFile = join(NODE_DIR, 'lib', 'sea.js')
  try {
    const content = await readFile(seaFile, 'utf8')
    if (content.includes('const isSea = () => true;')) {
      logger.success('lib/sea.js correctly modified (SEA override applied)')
    } else {
      logger.fail('lib/sea.js modification FAILED')
      logger.substep('Expected: const isSea = () => true;')
      allApplied = false
    }
  } catch (e) {
    logger.fail(`Cannot read lib/sea.js: ${e.message}`)
    allApplied = false
  }

  // Check 2: V8 include paths (v24.10.0+ doesn't need fixes).
  logger.log('Checking V8 include paths...')
  const testFile = join(NODE_DIR, 'deps/v8/src/heap/cppgc/heap-page.h')
  try {
    const content = await readFile(testFile, 'utf8')
    // For v24.10.0+, the CORRECT include has "src/" prefix
    if (content.includes('#include "src/base/iterator.h"')) {
      logger.success(
        'V8 include paths are correct (no modification needed for v24.10.0+)',
      )
    } else if (content.includes('#include "base/iterator.h"')) {
      logger.fail('V8 include paths were incorrectly modified!')
      logger.substep('v24.10.0+ needs "src/" prefix in includes')
      logger.substep('Build will fail - source was corrupted')
      allApplied = false
    } else {
      logger.warn('V8 include structure may have changed (cannot verify)')
    }
  } catch (e) {
    logger.warn(`Cannot verify V8 includes: ${e.message}`)
  }

  logger.logNewline()

  if (!allApplied) {
    printError(
      'Socket Modifications Not Applied',
      'Critical Socket modifications were not applied to Node.js source.',
      [
        'This is a BUG in the build script',
        'The binary will NOT work correctly with pkg',
        'Run: node scripts/build-yao-pkg-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Socket modifications verification failed')
  }

  logger.success('All Socket modifications verified')
  logger.logNewline()
}

/**
 * Apply Socket modifications and generate patches if needed
 */
async function applySocketModificationsDirectly() {
  console.log('🔧 Applying Socket modifications directly to source...')

  // V8 include path fixes are NOT needed for v24.10.0+
  // The yao-pkg patches for v24.10.0 already have correct include paths
  // Only v24.9.0 needed these fixes
  console.log(
    '   ℹ️  V8 include paths are correct for v24.10.0 (no fixes needed)',
  )

  // Fix 2: Enable SEA for pkg binaries
  const seaFile = join(NODE_DIR, 'lib', 'sea.js')
  try {
    const { readFileSync, writeFileSync } = await import('node:fs')
    let content = readFileSync(seaFile, 'utf8')
    const oldImport =
      "const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');"
    const newImport = `const isSea = () => true;
const { getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');`

    if (content.includes(oldImport)) {
      content = content.replace(oldImport, newImport)
      writeFileSync(seaFile, content, 'utf8')
      console.log('   ✓ Modified: lib/sea.js')
    }
  } catch (e) {
    console.warn(`   ⚠️  Skipped lib/sea.js: ${e.message}`)
  }

  console.log('✅ Socket modifications applied')
  console.log()
}

/**
 * Main build function.
 */
async function main() {
  logger.log('')
  logger.log('🔨 Socket CLI - Custom Node.js Builder')
  logger.log(
    `   Building Node.js ${NODE_VERSION} with yao-pkg + Socket patches`,
  )
  logger.log('')

  // Start timing total build.
  const totalStart = Date.now()

  // Initialize build log.
  await saveBuildLog(BUILD_DIR, '━'.repeat(60))
  await saveBuildLog(BUILD_DIR, '  Socket CLI - Custom Node.js Builder')
  await saveBuildLog(
    BUILD_DIR,
    `  Node.js ${NODE_VERSION} with yao-pkg + Socket patches`,
  )
  await saveBuildLog(BUILD_DIR, `  Started: ${new Date().toISOString()}`)
  await saveBuildLog(BUILD_DIR, '━'.repeat(60))
  await saveBuildLog(BUILD_DIR, '')

  // Phase 1: Pre-flight checks.
  await saveBuildLog(BUILD_DIR, 'Phase 1: Pre-flight Checks')
  await checkRequiredTools()
  await checkBuildEnvironment()
  await saveBuildLog(BUILD_DIR, 'Pre-flight checks completed')
  await saveBuildLog(BUILD_DIR, '')

  // Phase 2: Check if yao-pkg patch exists.
  await saveBuildLog(BUILD_DIR, 'Phase 2: Patch Availability Check')
  const patchAvailable = await checkYaoPkgPatch()
  if (!patchAvailable) {
    printError(
      'Cannot Proceed',
      `yao-pkg patch for ${NODE_VERSION} is not available.`,
      [
        'Update NODE_VERSION in this script to a supported version',
        'Check https://github.com/yao-pkg/pkg-fetch/tree/main/patches',
        'Or wait for yao-pkg to release patches for this version',
      ],
    )
    throw new Error('yao-pkg patch not available')
  }

  // Ensure patches directory exists.
  await mkdir(YAO_PATCHES_DIR, { recursive: true })

  // Check patches.json for offline builds and version validation.
  const patchesJsonPath = join(YAO_PATCHES_DIR, 'patches.json')
  let patchesMetadata = null
  if (existsSync(patchesJsonPath)) {
    try {
      const patchesContent = await readFile(patchesJsonPath, 'utf8')
      patchesMetadata = JSON.parse(patchesContent)

      // Validate that this Node version has a patch entry.
      if (patchesMetadata[NODE_VERSION]) {
        console.log(`✅ patches.json contains entry for ${NODE_VERSION}`)
        console.log(`   Expected patch: ${patchesMetadata[NODE_VERSION][0]}`)
        console.log()
      } else {
        console.log(
          `⚠️  patches.json does not contain entry for ${NODE_VERSION}`,
        )
        console.log(
          `   Available versions: ${Object.keys(patchesMetadata).join(', ')}`,
        )
        console.log('   Will attempt to download from yao-pkg...')
        console.log()
      }
    } catch (e) {
      console.warn(`⚠️  Could not read patches.json: ${e.message}`)
      console.log()
    }
  }

  // Download yao-pkg patch if needed.
  if (!existsSync(YAO_PATCH_FILE)) {
    printHeader('Downloading yao-pkg Patch')
    console.log(`Downloading from: ${YAO_PATCH_URL}`)
    console.log(`Saving to: ${YAO_PATCH_FILE}`)
    console.log('Auto-retry: Up to 3 attempts with integrity verification')
    console.log()

    try {
      await downloadWithRetry(YAO_PATCH_URL, YAO_PATCH_FILE, {
        maxRetries: 3,
        verifyIntegrity: true,
      })
      console.log('✅ Patch downloaded and verified successfully')
      console.log()

      // Update patches.json with new version.
      if (patchesMetadata && !patchesMetadata[NODE_VERSION]) {
        const patchFileName = `node.${NODE_VERSION}.cpp.patch`
        patchesMetadata[NODE_VERSION] = [patchFileName]

        const { writeFile } = await import('node:fs/promises')
        await writeFile(
          patchesJsonPath,
          `${JSON.stringify(patchesMetadata, null, 2)}\n`,
          'utf8',
        )
        console.log(`✅ Updated patches.json with ${NODE_VERSION}`)
        console.log()
      }
    } catch (e) {
      printError(
        'Download Failed',
        `Failed to download yao-pkg patch: ${e.message}`,
        [
          'Check your internet connection',
          'Try again in a few minutes',
          'Manually download the patch:',
          `  curl -L ${YAO_PATCH_URL} -o ${YAO_PATCH_FILE}`,
          'Then re-run this script',
        ],
      )
      throw new Error('Failed to download patch')
    }
  } else {
    console.log(`✅ yao-pkg patch already exists: ${YAO_PATCH_FILE}`)
    console.log()

    // Verify existing patch integrity.
    console.log('Verifying existing patch integrity...')
    const integrity = await verifyFileIntegrity(YAO_PATCH_FILE)
    if (!integrity.valid) {
      printWarning(
        'Corrupted Patch File',
        `Existing patch file is corrupted: ${integrity.reason}`,
        ['Re-downloading patch...'],
      )

      // Delete and re-download.
      const { unlink } = await import('node:fs/promises')
      await unlink(YAO_PATCH_FILE)

      console.log('Downloading fresh copy...')
      console.log()
      try {
        await downloadWithRetry(YAO_PATCH_URL, YAO_PATCH_FILE, {
          maxRetries: 3,
          verifyIntegrity: true,
        })
        console.log('✅ Patch re-downloaded and verified successfully')
        console.log()
      } catch (e) {
        printError(
          'Download Failed',
          `Failed to download yao-pkg patch: ${e.message}`,
          [
            'Check your internet connection',
            'Try again in a few minutes',
            'Manually download the patch:',
            `  curl -L ${YAO_PATCH_URL} -o ${YAO_PATCH_FILE}`,
            'Then re-run this script',
          ],
        )
        throw new Error('Failed to download patch')
      }
    } else {
      console.log('✅ Existing patch integrity verified')
      console.log()
    }
  }

  // Ensure build directory exists.
  await mkdir(BUILD_DIR, { recursive: true })

  // Phase 3: Verify Git tag exists before cloning.
  printHeader('Verifying Node.js Version')
  console.log(`Checking if ${NODE_VERSION} exists in Node.js repository...`)
  const tagCheck = await verifyGitTag(NODE_VERSION)
  if (!tagCheck.exists) {
    printError(
      'Invalid Node.js Version',
      `Version ${NODE_VERSION} does not exist in Node.js repository.`,
      [
        'Check available versions: https://github.com/nodejs/node/tags',
        'Update NODE_VERSION in this script to a valid version',
        'Make sure version starts with "v" (e.g., v24.10.0)',
      ],
    )
    throw new Error('Invalid Node.js version')
  }
  console.log(`✅ ${NODE_VERSION} exists in Node.js repository`)
  console.log()

  // Clone or reset Node.js repository.
  if (!existsSync(NODE_DIR) || CLEAN_BUILD) {
    if (existsSync(NODE_DIR) && CLEAN_BUILD) {
      printHeader('Clean Build Requested')
      console.log('Removing existing Node.js source directory...')
      const { rm } = await import('node:fs/promises')
      await rm(NODE_DIR, { recursive: true, force: true })
      await cleanCheckpoint(BUILD_DIR)
      console.log('✅ Cleaned build directory')
      console.log()
    }

    printHeader('Cloning Node.js Source')
    console.log(`Version: ${NODE_VERSION}`)
    console.log('Repository: https://github.com/nodejs/node.git')
    console.log()
    console.log('⏱️  This will download ~2GB of data...')
    console.log('Retry: Up to 3 attempts if clone fails')
    console.log()

    // Git clone with retry (network can fail during long downloads).
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`Retry attempt ${attempt}/3...`)
          console.log()
        }

        await exec(
          'git',
          [
            'clone',
            '--depth',
            '1',
            '--branch',
            NODE_VERSION,
            'https://github.com/nodejs/node.git',
            '.',
          ],
          { cwd: BUILD_DIR },
        )
        cloneSuccess = true
        break
      } catch (e) {
        if (attempt === 3) {
          printError(
            'Git Clone Failed',
            `Failed to clone Node.js repository after 3 attempts: ${e.message}`,
            [
              'Check your internet connection',
              'Try again in a few minutes',
              'Manually clone:',
              `  mkdir -p ${BUILD_DIR}`,
              `  cd ${BUILD_DIR}`,
              `  git clone --depth 1 --branch ${NODE_VERSION} https://github.com/nodejs/node.git .`,
            ],
          )
          throw new Error('Git clone failed after retries')
        }

        console.warn(`⚠️  Clone attempt ${attempt} failed: ${e.message}`)

        // Clean up partial clone.
        try {
          const { rm } = await import('node:fs/promises')
          await rm(NODE_DIR, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors.
        }

        // Wait before retry.
        const waitTime = 2000 * attempt
        console.log(`⏱️  Waiting ${waitTime}ms before retry...`)
        console.log()
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      console.log('✅ Node.js source cloned successfully')
      await createCheckpoint(BUILD_DIR, 'cloned')
      console.log()
    }
  } else {
    printHeader('Using Existing Node.js Source')
    console.log('Fetching latest tags...')
    await exec(
      'git',
      [
        'fetch',
        '--depth',
        '1',
        'origin',
        `refs/tags/${NODE_VERSION}:refs/tags/${NODE_VERSION}`,
      ],
      {
        cwd: NODE_DIR,
      },
    )
    console.log('Resetting to clean state...')
    await exec('git', ['reset', '--hard', NODE_VERSION], { cwd: NODE_DIR })
    await exec('git', ['clean', '-fdx'], { cwd: NODE_DIR })
    console.log('✅ Node.js source reset to clean state')
    console.log()
  }

  // Validate yao-pkg patch before applying.
  printHeader('Validating yao-pkg Patch')
  console.log('Checking patch integrity and compatibility...')
  console.log()

  const yaoPatchValidation = await validatePatch(YAO_PATCH_FILE, NODE_VERSION)
  if (!yaoPatchValidation.valid) {
    printError('yao-pkg Patch Validation Failed', yaoPatchValidation.reason, [
      'Re-download the patch:',
      `  curl -o "${YAO_PATCH_FILE}" "${YAO_PATCH_URL}"`,
      'Or try with --clean flag: node scripts/build-yao-pkg-node.mjs --clean',
      'Check yao-pkg releases for compatible Node versions',
    ])
    throw new Error('yao-pkg patch validation failed')
  }

  if (yaoPatchValidation.metadata?.description) {
    console.log(`📝 Patch: ${yaoPatchValidation.metadata.description}`)
  }
  console.log('✅ yao-pkg patch is valid and compatible')
  console.log()

  // Test yao-pkg patch application (dry-run).
  printHeader('Testing yao-pkg Patch Application')
  console.log('Running dry-run to ensure patch will apply cleanly...')
  console.log()

  const yaoPatchDryRun = await testPatchApplication(YAO_PATCH_FILE, NODE_DIR, 1)
  if (!yaoPatchDryRun.canApply) {
    printError('yao-pkg Patch Dry-Run Failed', yaoPatchDryRun.reason, [
      'The patch cannot be applied to this Node.js version',
      'Try with --clean flag: node scripts/build-yao-pkg-node.mjs --clean',
      'Verify NODE_VERSION matches yao-pkg patch version',
      'Check if source was modified:',
      `  cd ${NODE_DIR} && git status`,
    ])
    if (yaoPatchDryRun.stderr) {
      console.error('Patch error output:')
      console.error(yaoPatchDryRun.stderr)
    }
    throw new Error('yao-pkg patch dry-run failed')
  }

  console.log('✅ yao-pkg patch dry-run successful (patch will apply cleanly)')
  console.log()

  // Apply yao-pkg patch.
  printHeader('Applying yao-pkg Patches')
  console.log('These patches enable:')
  console.log('  • V8 bytecode compilation without source code')
  console.log('  • PKG bootstrap system')
  console.log('  • BAKERY placeholder for runtime args')
  console.log()

  try {
    // Use --batch to avoid interactive prompts (for automation).
    // Use --forward to skip patches that appear already applied.
    await exec(
      'sh',
      ['-c', `patch -p1 --batch --forward < "${YAO_PATCH_FILE}"`],
      { cwd: NODE_DIR },
    )
    console.log('✅ yao-pkg patch applied successfully')
    console.log()
  } catch {
    printError(
      'yao-pkg Patch Failed',
      'The yao-pkg patch could not be applied to Node.js source.',
      [
        'The patch may not be compatible with this Node.js version',
        'Try with --clean flag: node scripts/build-yao-pkg-node.mjs --clean',
        'Check yao-pkg releases for compatible Node versions',
        'Verify NODE_VERSION matches yao-pkg patch version',
      ],
    )
    throw new Error('Failed to apply yao-pkg patch')
  }

  // Apply Socket-specific patches (or modifications directly).
  const socketPatches = findSocketPatches()

  if (socketPatches.length > 0) {
    // Validate Socket patches before applying.
    printHeader('Validating Socket Patches')
    console.log(`Found ${socketPatches.length} patch(es) for ${NODE_VERSION}`)
    console.log('Checking integrity, compatibility, and conflicts...')
    console.log()

    const patchData = []
    let allValid = true

    for (const patchFile of socketPatches) {
      const patchPath = join(SOCKET_PATCHES_DIR, patchFile)
      console.log(`Validating ${patchFile}...`)

      const validation = await validatePatch(patchPath, NODE_VERSION)
      if (!validation.valid) {
        console.error(`  ❌ INVALID: ${validation.reason}`)
        allValid = false
        continue
      }

      const content = await readFile(patchPath, 'utf8')
      const metadata = validation.metadata
      const analysis = analyzePatchContent(content)

      patchData.push({
        name: patchFile,
        path: patchPath,
        metadata,
        analysis,
      })

      if (metadata?.description) {
        console.log(`  📝 ${metadata.description}`)
      }
      if (analysis.modifiesV8Includes) {
        console.log('  ⚠️  Modifies V8 includes')
      }
      if (analysis.modifiesSEA) {
        console.log('  ✓ Modifies SEA detection')
      }
      console.log('  ✅ Valid')
      console.log()
    }

    if (!allValid) {
      printError(
        'Socket Patch Validation Failed',
        'One or more Socket patches are invalid or incompatible.',
        [
          'Check patch files for corruption',
          'Verify patches match Node.js version',
          'Falling back to direct modifications...',
        ],
      )
      await applySocketModificationsDirectly()
    } else {
      // Check for conflicts between patches.
      const conflicts = checkPatchConflicts(patchData, NODE_VERSION)
      if (conflicts.length > 0) {
        console.warn('⚠️  Patch Conflicts Detected:')
        console.warn()
        for (const conflict of conflicts) {
          if (conflict.severity === 'error') {
            console.error(`  ❌ ERROR: ${conflict.message}`)
            allValid = false
          } else {
            console.warn(`  ⚠️  WARNING: ${conflict.message}`)
          }
        }
        console.warn()

        if (!allValid) {
          printError(
            'Critical Patch Conflicts',
            'Patches have critical conflicts and cannot be applied.',
            [
              'Remove conflicting patches',
              'Use version-specific patches',
              'Falling back to direct modifications...',
            ],
          )
          await applySocketModificationsDirectly()
        }
      } else {
        console.log('✅ All Socket patches validated successfully')
        console.log('✅ No conflicts detected')
        console.log()
      }

      // Test Socket patches (dry-run) before applying.
      if (allValid) {
        printHeader('Testing Socket Patch Application')
        console.log('Running dry-run to ensure patches will apply cleanly...')
        console.log()

        for (const { name, path: patchPath } of patchData) {
          console.log(`Testing ${name}...`)
          const dryRun = await testPatchApplication(patchPath, NODE_DIR, 1)
          if (!dryRun.canApply) {
            console.error(`  ❌ Cannot apply: ${dryRun.reason}`)
            if (dryRun.stderr) {
              console.error(`  Error: ${dryRun.stderr}`)
            }
            allValid = false
          } else {
            console.log('  ✅ Will apply cleanly')
          }
        }
        console.log()

        if (!allValid) {
          printWarning(
            'Socket Patches Cannot Be Applied',
            'One or more Socket patches failed dry-run test.',
            [
              'Patches may be outdated for this Node.js version',
              'Falling back to direct modifications...',
            ],
          )
          await applySocketModificationsDirectly()
        }
      }

      // Apply patches if validation and dry-run passed.
      if (allValid) {
        printHeader('Applying Socket Patches')
        for (const { name, path: patchPath } of patchData) {
          console.log(`Applying ${name}...`)
          try {
            // Use -p1 to match Git patch format (strips a/ and b/ prefixes).
            // Use --batch to avoid interactive prompts.
            // Use --forward to skip if already applied.
            await exec(
              'sh',
              ['-c', `patch -p1 --batch --forward < "${patchPath}"`],
              { cwd: NODE_DIR },
            )
            console.log(`✅ ${name} applied`)
          } catch {
            printError(
              'Socket Patch Failed',
              `Socket patch ${name} could not be applied.`,
              [
                'The patch may be outdated for this Node.js version',
                'Trying direct modifications instead...',
                'If this persists, regenerate patches:',
                `  node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}`,
              ],
            )
            // Fall back to direct modifications.
            await applySocketModificationsDirectly()
            break
          }
        }
        console.log('✅ All Socket patches applied successfully')
        console.log()
      }
    }
  } else {
    printHeader('Applying Socket Modifications')
    console.log(`No patches found for ${NODE_VERSION}`)
    console.log('Applying modifications directly to source files...')
    console.log()
    console.log('This is normal for new Node.js versions.')
    console.log('After build succeeds, you can generate patches:')
    console.log(
      `  node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}`,
    )
    console.log()
    await applySocketModificationsDirectly()
  }

  // Verify modifications were applied.
  await verifySocketModifications()

  // Configure Node.js with optimizations.
  printHeader('Configuring Node.js Build')
  console.log('Optimization flags:')
  console.log('  ✅ KEEP: V8 full compiler (bytecode), WASM, JIT, SSL/crypto')
  console.log('  ❌ REMOVE: npm, corepack, inspector, amaro, sqlite')
  console.log('  🌍 ICU: small-icu (English-only, saves ~5MB)')
  console.log(
    '  💾 OPTIMIZATIONS: no-snapshot (~2-3MB), no-code-cache (~2-3MB), no-object-print (~0.5MB)',
  )
  console.log()
  console.log(
    'Expected binary size: ~82MB (before stripping), ~47-49MB (after)',
  )
  console.log()

  const configureFlags = [
    '--with-intl=small-icu',
    '--without-npm',
    '--without-corepack',
    '--without-inspector',
    '--without-amaro',
    '--without-sqlite',
    '--without-node-snapshot',
    '--without-node-code-cache',
    '--v8-disable-object-print',
    '--without-node-options',
    '--enable-lto',
  ]

  // Add architecture flag for cross-compilation or explicit targeting.
  if (ARCH === 'arm64') {
    configureFlags.unshift('--dest-cpu=arm64')
  } else if (ARCH === 'x64') {
    configureFlags.unshift('--dest-cpu=x64')
  }

  await exec('./configure', configureFlags, { cwd: NODE_DIR })
  console.log('✅ Configuration complete')
  console.log()

  // Build Node.js.
  printHeader('Building Node.js')

  const timeEstimate = estimateBuildTime(CPU_COUNT)
  console.log(
    `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
  )
  console.log(`🚀 Using ${CPU_COUNT} CPU cores for parallel compilation`)
  console.log()
  console.log('You can:')
  console.log('  • Grab coffee ☕')
  console.log('  • Work on other tasks')
  console.log('  • Watch progress in this terminal')
  console.log()
  console.log(`Build log: ${getBuildLogPath(BUILD_DIR)}`)
  console.log()
  console.log('Starting build...')
  console.log()

  const buildStart = Date.now()

  try {
    await exec('make', [`-j${CPU_COUNT}`], { cwd: NODE_DIR })
  } catch (e) {
    // Build failed - show last 50 lines of build log.
    const lastLines = await getLastLogLines(BUILD_DIR, 50)
    if (lastLines) {
      console.error()
      console.error('Last 50 lines of build log:')
      console.error('━'.repeat(60))
      console.error(lastLines)
      console.error('━'.repeat(60))
    }

    printError(
      'Build Failed',
      'Node.js compilation failed. See build log for details.',
      [
        `Full log: ${getBuildLogPath(BUILD_DIR)}`,
        'Common issues:',
        '  - Out of memory: Close other applications',
        '  - Disk full: Free up disk space',
        '  - Compiler error: Check C++ compiler version',
        'Try again with: node scripts/build-yao-pkg-node.mjs --clean',
      ],
    )
    throw e
  }

  const buildDuration = Date.now() - buildStart
  const buildTime = formatDuration(buildDuration)

  console.log()
  console.log(`✅ Build completed in ${buildTime}`)
  await createCheckpoint(BUILD_DIR, 'built')
  console.log()

  // Test the binary.
  printHeader('Testing Binary')
  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')

  console.log('Running basic functionality tests...')
  console.log()

  await exec(nodeBinary, ['--version'], {
    env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
  })

  await exec(
    nodeBinary,
    ['-e', 'console.log("✅ Binary can execute JavaScript")'],
    {
      env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    },
  )

  console.log()
  console.log('✅ Binary is functional')
  console.log()

  // Copy unmodified binary to build/out/Release.
  printHeader('Copying to Build Output (Release)')
  logger.log('Copying unmodified binary to build/out/Release directory...')
  logger.logNewline()

  const outputReleaseDir = join(BUILD_DIR, 'out', 'Release')
  await mkdir(outputReleaseDir, { recursive: true })
  const outputReleaseBinary = join(outputReleaseDir, 'node')
  await exec('cp', [nodeBinary, outputReleaseBinary])

  logger.substep(`Release directory: ${outputReleaseDir}`)
  logger.substep('Binary: node (unmodified)')
  logger.logNewline()
  logger.success('Unmodified binary copied to build/out/Release')
  logger.logNewline()

  // Strip debug symbols to reduce size.
  printHeader('Optimizing Binary Size')
  const sizeBeforeStrip = await getFileSize(nodeBinary)
  console.log(`Size before stripping: ${sizeBeforeStrip}`)
  console.log('Removing debug symbols...')
  console.log()
  await exec('strip', [nodeBinary])
  const sizeAfterStrip = await getFileSize(nodeBinary)
  console.log(`Size after stripping: ${sizeAfterStrip}`)

  // Parse and check size.
  const sizeMatch = sizeAfterStrip.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && size >= 50 && size <= 60) {
      console.log('✅ Binary size is optimal (~54MB expected)')
    } else if (unit === 'M' && size < 50) {
      printWarning(
        'Binary Smaller Than Expected',
        `Binary is ${sizeAfterStrip}, expected ~54MB.`,
        [
          'Some features may be missing',
          'Verify configure flags were applied correctly',
        ],
      )
    } else if (unit === 'M' && size > 70) {
      printWarning(
        'Binary Larger Than Expected',
        `Binary is ${sizeAfterStrip}, expected ~54MB.`,
        [
          'Debug symbols may not be fully stripped',
          'Configure flags may not be applied',
          'Binary will still work but will be larger',
        ],
      )
    }
  }

  console.log()

  // Smoke test binary after stripping (ensure strip didn't corrupt it).
  console.log('Testing binary after stripping...')
  const smokeTest = await smokeTestBinary(nodeBinary, {
    ...process.env,
    PKG_EXECPATH: 'PKG_INVOKE_NODEJS',
  })

  if (!smokeTest.passed) {
    printError(
      'Binary Corrupted After Stripping',
      `Binary failed smoke test: ${smokeTest.reason}`,
      [
        'Strip command may have corrupted the binary',
        'Try rebuilding: node scripts/build-yao-pkg-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary corrupted after stripping')
  }

  console.log('✅ Binary functional after stripping')
  console.log()

  // Copy stripped binary to build/out/Stripped.
  printHeader('Copying to Build Output (Stripped)')
  logger.log('Copying stripped binary to build/out/Stripped directory...')
  logger.logNewline()

  const outputStrippedDir = join(BUILD_DIR, 'out', 'Stripped')
  await mkdir(outputStrippedDir, { recursive: true })
  const outputStrippedBinary = join(outputStrippedDir, 'node')
  await exec('cp', [nodeBinary, outputStrippedBinary])

  logger.substep(`Stripped directory: ${outputStrippedDir}`)
  logger.substep('Binary: node (stripped)')
  logger.logNewline()
  logger.success('Stripped binary copied to build/out/Stripped')
  logger.logNewline()

  // Sign for macOS ARM64.
  if (IS_MACOS && ARCH === 'arm64') {
    printHeader('Code Signing (macOS ARM64)')
    logger.log('Signing binary for macOS ARM64 compatibility...')
    logger.logNewline()
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])

    const sigInfo = await execCapture('codesign', ['-dv', nodeBinary], {
      env: { ...process.env, STDERR: '>&1' },
    })
    logger.log(sigInfo)
    logger.logNewline()
    logger.success('Binary signed successfully')
    logger.logNewline()
  }

  // Copy signed binary to build/out/Signed.
  printHeader('Copying to Build Output (Signed)')
  logger.log('Copying signed binary to build/out/Signed directory...')
  logger.logNewline()

  const outputSignedDir = join(BUILD_DIR, 'out', 'Signed')
  await mkdir(outputSignedDir, { recursive: true })
  const outputSignedBinary = join(outputSignedDir, 'node')
  await exec('cp', [nodeBinary, outputSignedBinary])

  logger.substep(`Signed directory: ${outputSignedDir}`)
  logger.substep('Binary: node (stripped + signed)')
  logger.logNewline()
  logger.success('Signed binary copied to build/out/Signed')
  logger.logNewline()

  // Copy signed binary to build/out/Sea (for SEA builds).
  printHeader('Copying to Build Output (Sea)')
  logger.log(
    'Copying signed binary to build/out/Sea directory for SEA builds...',
  )
  logger.logNewline()

  const outputSeaDir = join(BUILD_DIR, 'out', 'Sea')
  await mkdir(outputSeaDir, { recursive: true })
  const outputSeaBinary = join(outputSeaDir, 'node')
  await exec('cp', [nodeBinary, outputSeaBinary])

  logger.substep(`Sea directory: ${outputSeaDir}`)
  logger.substep('Binary: node (stripped + signed, ready for SEA)')
  logger.logNewline()
  logger.success('Binary copied to build/out/Sea')
  logger.logNewline()

  // Copy to yao-pkg cache directory (for yao-pkg to use).
  const pkgCacheDir = join(
    process.env.HOME || process.env.USERPROFILE,
    '.pkg-cache',
    'v3.5',
  )
  const targetName = `built-${NODE_VERSION}-${platform()}-${ARCH}${IS_MACOS && ARCH === 'arm64' ? '-signed' : ''}`
  const targetPath = join(pkgCacheDir, targetName)

  printHeader('Installing to pkg Cache (for yao-pkg)')
  logger.log('Installing binary to pkg cache so yao-pkg can find it...')
  logger.logNewline()
  logger.substep(`Source: ${outputSignedBinary}`)
  logger.substep(`Cache directory: ${pkgCacheDir}`)
  logger.substep(`Binary name: ${targetName}`)
  logger.logNewline()

  await mkdir(pkgCacheDir, { recursive: true })
  await exec('cp', [outputSignedBinary, targetPath])

  // Verify it was copied.
  if (!existsSync(targetPath)) {
    printError(
      'Cache Installation Failed',
      'Binary was not copied to pkg cache successfully.',
      [
        'Check permissions on ~/.pkg-cache directory',
        `Manually copy: cp build/out/Signed/node ~/.pkg-cache/v3.5/${targetName}`,
      ],
    )
    throw new Error('Failed to install binary to pkg cache')
  }

  console.log('✅ Binary installed to pkg cache successfully')
  console.log()

  // Verify the cached binary works.
  printHeader('Verifying Cached Binary')
  console.log('Testing that pkg can use the installed binary...')
  console.log()

  const cacheTest = await smokeTestBinary(targetPath, {
    ...process.env,
    PKG_EXECPATH: 'PKG_INVOKE_NODEJS',
  })

  if (!cacheTest.passed) {
    printError(
      'Cached Binary Verification Failed',
      `Binary in pkg cache failed smoke test: ${cacheTest.reason}`,
      [
        'Binary may be corrupted during copy',
        'Try rebuilding with --clean flag',
        `Remove cached binary: rm ${targetPath}`,
        'Then rebuild: node scripts/build-yao-pkg-node.mjs --clean',
      ],
    )
    throw new Error('Cached binary verification failed')
  }

  console.log('✅ Cached binary passed smoke test')
  console.log('✅ pkg can use this binary')
  console.log()

  // Copy final binary to build/out/Yao.
  printHeader('Copying Final Binary to build/out/Yao')
  logger.log('Creating final yao-pkg binary location...')
  logger.logNewline()

  const yaoOutputDir = join(BUILD_DIR, 'out', 'Yao')
  await mkdir(yaoOutputDir, { recursive: true })
  const yaoOutputBinary = join(yaoOutputDir, 'node')
  await exec('cp', [outputSignedBinary, yaoOutputBinary])

  logger.substep(`Yao directory: ${yaoOutputDir}`)
  logger.substep('Binary: node (final yao-pkg build)')
  logger.logNewline()
  logger.success('Final binary copied to build/out/Yao')
  logger.logNewline()

  // Report build complete.
  const binarySize = await getFileSize(yaoOutputBinary)
  await createCheckpoint(BUILD_DIR, 'complete')
  await cleanCheckpoint(BUILD_DIR)

  // Calculate total build time.
  const totalDuration = Date.now() - totalStart
  const totalTime = formatDuration(totalDuration)

  printHeader('🎉 Build Complete!')

  // ASCII art success.
  logger.logNewline()
  logger.log('    ╔═══════════════════════════════════════╗')
  logger.log('    ║                                       ║')
  logger.log('    ║     ✨ Build Successful! ✨          ║')
  logger.log('    ║                                       ║')
  logger.log('    ╚═══════════════════════════════════════╝')
  logger.logNewline()

  logger.log('📊 Build Statistics:')
  logger.log(`   Build time: ${buildTime}`)
  logger.log(`   Total time: ${totalTime}`)
  logger.log(`   Binary size: ${binarySize}`)
  logger.log(`   CPU cores used: ${CPU_COUNT}`)
  logger.logNewline()

  logger.log('📁 Binary Locations:')
  logger.log(`   Source:       ${nodeBinary}`)
  logger.log(`   Release:      ${outputReleaseBinary}`)
  logger.log(`   Stripped:     ${outputStrippedBinary}`)
  logger.log(`   Signed:       ${outputSignedBinary}`)
  logger.log(`   Final (Yao):  ${yaoOutputBinary}`)
  logger.log(`   pkg cache:    ${targetPath}`)
  logger.logNewline()

  logger.log('🚀 Next Steps:')
  logger.log('   1. Build Socket CLI:')
  logger.log('      pnpm run build')
  logger.logNewline()
  logger.log('   2. Create pkg executable:')
  logger.log('      pnpm exec pkg .')
  logger.logNewline()
  logger.log('   3. Test the executable:')
  logger.log('      ./pkg-binaries/socket-macos-arm64 --version')
  logger.logNewline()

  logger.log('💡 Helpful Commands:')
  logger.log('   Verify build: node scripts/verify-node-build.mjs')
  logger.log('   Integration test: node scripts/test-yao-pkg-integration.mjs')
  logger.logNewline()

  logger.log('📚 Documentation:')
  logger.log('   Build process: build/patches/README.md')
  logger.log('   Troubleshooting: See README for common issues')
  logger.logNewline()

  if (RUN_VERIFY) {
    printHeader('Running Verification')
    logger.log('Running comprehensive verification checks...')
    logger.logNewline()

    try {
      await exec(
        'node',
        ['scripts/verify-node-build.mjs', `--node-version=${NODE_VERSION}`],
        {
          cwd: ROOT_DIR,
        },
      )
      // eslint-disable-next-line no-unused-vars
    } catch (_e) {
      printWarning(
        'Verification Failed',
        'Build completed but verification found issues.',
        [
          'Review verification output above',
          'Run manually: node scripts/verify-node-build.mjs',
        ],
      )
    }
  } else {
    logger.info('Tip: Run verification checks:')
    logger.substep('node scripts/verify-node-build.mjs')
    logger.logNewline()
  }

  // Step 10: Run tests if requested.
  if (RUN_TESTS || RUN_FULL_TESTS) {
    printHeader('Running Tests with Custom Node')
    logger.log(`Testing Socket CLI with custom Node.js ${NODE_VERSION}...`)
    logger.logNewline()

    try {
      const testArgs = [
        'scripts/test-with-custom-node.mjs',
        `--node-version=${NODE_VERSION}`,
      ]
      if (RUN_FULL_TESTS) {
        testArgs.push('--full')
      }

      await exec('node', testArgs, { cwd: ROOT_DIR })

      logger.logNewline()
      logger.success('Tests passed with custom Node.js binary!')
      logger.logNewline()
      // eslint-disable-next-line no-unused-vars
    } catch (_e) {
      printError(
        'Tests Failed',
        'Tests failed when using the custom Node.js binary.',
        [
          'Review test output above for details',
          'The binary may have issues with Socket CLI',
          'Consider rebuilding: node scripts/build-yao-pkg-node.mjs --clean',
          'Or run tests manually: node scripts/test-with-custom-node.mjs',
        ],
      )
      throw new Error('Tests failed with custom Node.js')
    }
  } else if (!RUN_VERIFY) {
    logger.info('Tip: Test with custom Node:')
    logger.substep('node scripts/test-with-custom-node.mjs')
    logger.logNewline()
  }
}

// Run main function.
main().catch(e => {
  logger.fail(`Build failed: ${e.message}`)
  throw e
})
