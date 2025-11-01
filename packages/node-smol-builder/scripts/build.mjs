/**
 * @fileoverview Build Node.js v24.10.0 with custom patches
 *
 * This script produces a custom Node binary for Socket CLI distribution.
 * It clones Node.js source, applies custom patches, configures with
 * size optimizations, and builds a standalone binary.
 *
 * Binary Size Optimization Strategy:
 *
 *   Starting size:                 ~49 MB (default Node.js v24 build)
 *
 *   Stage 1: Configure flags
 *     + --with-intl=small-icu:     ~44 MB  (-5 MB:  English-only ICU)
 *     + --v8-lite-mode:            ~29 MB  (-20 MB: Disable TurboFan JIT)
 *     + --disable-SEA:             ~28 MB  (-21 MB: Remove SEA support)
 *     + --without-* flags:         ~27 MB  (-22 MB: Remove npm, inspector, etc.)
 *
 *   Stage 2: Binary stripping
 *     + strip --strip-all:         ~25 MB  (-24 MB: Remove debug symbols)
 *
 *   Stage 3: Compression (this script)
 *     + pkg Brotli (VFS):          ~23 MB  (-26 MB: Compress Socket CLI code)
 *     + Node.js lib/ minify+Brotli:~21 MB  (-28 MB: Compress built-in modules)
 *
 *   TARGET EXPECTED: ~21 MB (small-icu adds ~3MB vs intl=none)
 *
 * Size Breakdown:
 *   - Node.js lib/ (compressed):   ~2.5 MB  (minified + Brotli)
 *   - Socket CLI (VFS):           ~13 MB    (pkg Brotli)
 *   - Native code (V8, libuv):     ~2.5 MB  (stripped)
 *
 * Compression Approach:
 *   1. Node.js built-in modules:  esbuild minify → Brotli quality 11
 *   2. Socket CLI application:    pkg automatic Brotli compression
 *
 * Performance Impact:
 *   - Startup overhead:           ~50-100 ms (one-time decompression)
 *   - Runtime performance:        ~5-10x slower JS (V8 Lite mode)
 *   - WASM performance:           Unaffected (Liftoff baseline compiler)
 *
 * Usage:
 *   node scripts/load.mjs build-custom-node              # Normal build
 *   node scripts/load.mjs build-custom-node --clean      # Force fresh build
 *   node scripts/load.mjs build-custom-node --yes        # Auto-yes to prompts
 *   node scripts/load.mjs build-custom-node --verify     # Verify after build
 *   node scripts/load.mjs build-custom-node --test       # Build + run smoke tests
 *   node scripts/load.mjs build-custom-node --test-full  # Build + run full tests
 */

import { existsSync, readdirSync } from 'node:fs'
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { cpus, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { whichBinSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import nodeVersionConfig from '@socketsecurity/bootstrap/node-version.json' with { type: 'json' }

const { version: NODE_VERSION } = nodeVersionConfig
import colors from 'yoctocolors-cjs'

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
  verifyGitTag,
} from '@socketsecurity/build-infra/lib/build-helpers'
import {
  generateHashComment,
  shouldExtract,
} from '@socketsecurity/build-infra/lib/extraction-cache'
import { printError, printHeader, printWarning } from '@socketsecurity/build-infra/lib/build-output'
import {
  analyzePatchContent,
  checkPatchConflicts,
  testPatchApplication,
  validatePatch,
} from '@socketsecurity/build-infra/lib/patch-validator'
import {
  ensureAllToolsInstalled,
  ensurePackageManagerAvailable,
  getInstallInstructions,
  getPackageManagerInstructions,
} from '@socketsecurity/build-infra/lib/tool-installer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Execute command using spawn (replacement for exec).
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {Promise<void>}
 */
async function exec(command, args = [], options = {}) {
  const result = await spawn(
    Array.isArray(args) ? command : `${command} ${args}`,
    Array.isArray(args) ? args : [],
    {
      stdio: 'inherit',
      shell: WIN32,
      ...options,
    }
  )
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
}

/**
 * Execute command and capture output (replacement for execCapture).
 *
 * @param {string} command - Command to execute
 * @param {object} options - Spawn options
 * @returns {Promise<string>} Command output
 */
async function execCapture(command, options = {}) {
  const result = await spawn(command, [], {
    stdio: 'pipe',
    stdioString: true,
    shell: WIN32,
    ...options,
  })
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
  return (result.stdout ?? '').trim()
}

// Parse arguments.
const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
    clean: { type: 'boolean' },
    dev: { type: 'boolean' },
    platform: { type: 'string' },
    prod: { type: 'boolean' },
    test: { type: 'boolean' },
    'test-full': { type: 'boolean' },
    verify: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
  },
  strict: false,
})

const TARGET_PLATFORM = values.platform || platform()
const TARGET_ARCH = values.arch || process.arch
const CLEAN_BUILD = !!values.clean
const RUN_VERIFY = !!values.verify
const RUN_TESTS = !!values.test
const RUN_FULL_TESTS = !!values['test-full'] || !!values.testFull
const AUTO_YES = !!values.yes

// Build mode: dev (fast builds) vs prod (optimized builds).
// Default to dev unless CI or --prod specified.
const IS_PROD_BUILD = values.prod || (!values.dev && 'CI' in process.env)
const IS_DEV_BUILD = !IS_PROD_BUILD

// Configuration
const ROOT_DIR = join(__dirname, '..')
const NODE_SOURCE_DIR = join(ROOT_DIR, 'build', 'node-source')
const NODE_DIR = NODE_SOURCE_DIR // Alias for compatibility.
const BUILD_DIR = join(ROOT_DIR, 'build')
const PATCHES_DIR = join(ROOT_DIR, 'patches')
const ADDITIONS_DIR = join(ROOT_DIR, 'additions')

// Directory structure.
// build/node-source/ - Node.js source code (gitignored).
// build/node-source/out/Release/node - Node.js build output (gitignored).
// build/out/Release/node - Copy of Release binary (gitignored).
// build/out/Stripped/node - Stripped binary (gitignored).
// build/out/Signed/node - Stripped + signed binary (macOS ARM64 only, gitignored).
// build/out/Final/node - Final binary for distribution (gitignored).
// build/out/Sea/node - Binary for SEA builds (gitignored).
// build/out/Distribution/node - Final distribution binary (gitignored).
// build/patches/ - All Node.js custom patches (tracked in git).

/**
 * Collect all source files that contribute to the smol build.
 * Used for hash-based caching to detect when rebuild is needed.
 *
 * Cache Key Strategy (Local Script):
 * ===================================
 * This function generates a content-based hash using @socketsecurity/build-infra/lib/extraction-cache.
 * The cache key is determined by hashing the CONTENT of these files:
 *
 * 1. All patch files (patches/*.patch)
 *    - Any change to Node.js patches invalidates cache
 *    - Example: patches/enable-brotli-loading-v24.patch
 *
 * 2. All addition files (additions/**)
 *    - Includes headers, source files, tools added to Node.js source tree
 *    - Example: additions/tools/socket_macho_decompress
 *
 * 3. This build script itself (scripts/build.mjs)
 *    - Changes to build configuration flags invalidate cache
 *    - Example: modifying --without-node-code-cache flag
 *
 * NOTE: This differs from GitHub Actions cache key (see .github/workflows/build-smol.yml):
 * - GitHub: Hashes file PATHS and includes bootstrap dependencies
 * - Local: Hashes file CONTENT only (more precise, no bootstrap dependency)
 * - Both: Stored in build/.cache/node.hash (local) or Actions cache (CI)
 *
 * @returns {string[]} Array of absolute paths to all source files
 */
function collectBuildSourceFiles() {
  const sources = []

  // Add all patch files.
  if (existsSync(PATCHES_DIR)) {
    const patchFiles = readdirSync(PATCHES_DIR)
      .filter(f => f.endsWith('.patch'))
      .map(f => join(PATCHES_DIR, f))
    sources.push(...patchFiles)
  }

  // Add all addition files recursively.
  if (existsSync(ADDITIONS_DIR)) {
    const addFiles = readdirSync(ADDITIONS_DIR, { recursive: true })
      .filter(f => {
        const fullPath = join(ADDITIONS_DIR, f)
        try {
          return existsSync(fullPath) && !readdirSync(fullPath, { withFileTypes: true }).length
        } catch {
          return true // It's a file, not a directory.
        }
      })
      .map(f => join(ADDITIONS_DIR, f))
    sources.push(...addFiles)
  }

  // Add this build script itself (changes to build logic should trigger rebuild).
  sources.push(__filename)

  return sources
}

/**
 * Find Socket patches for this Node version.
 * Includes both static patches (patches/) and dynamic patches (build/patches/).
 */
function findSocketPatches() {
  const patches = []

  // Get static patches from patches/ directory.
  if (existsSync(PATCHES_DIR)) {
    const staticPatches = readdirSync(PATCHES_DIR)
      .filter(f => f.endsWith('.patch') && !f.endsWith('.template.patch'))
      .map(f => ({ name: f, path: join(PATCHES_DIR, f), source: 'patches/' }))
    patches.push(...staticPatches)
  }

  // Get dynamic patches from build/patches/ directory.
  const buildPatchesDir = join(BUILD_DIR, 'patches')
  if (existsSync(buildPatchesDir)) {
    const dynamicPatches = readdirSync(buildPatchesDir)
      .filter(f => f.endsWith('.patch'))
      .map(f => ({ name: f, path: join(buildPatchesDir, f), source: 'build/patches/' }))
    patches.push(...dynamicPatches)
  }

  // Sort by name for consistent ordering.
  patches.sort((a, b) => a.name.localeCompare(b.name))

  if (patches.length > 0) {
    getDefaultLogger().log(`   Found ${patches.length} patch file(s):`)
    for (const patch of patches) {
      getDefaultLogger().log(`     → ${patch.name} (${patch.source})`)
    }
  }

  return patches
}

/**
 * Copy build additions to Node.js source tree
 */
async function copyBuildAdditions() {
  if (!existsSync(ADDITIONS_DIR)) {
    getDefaultLogger().log('   No build additions directory found, skipping')
    return
  }

  printHeader('Copying Build Additions')

  // Recursively copy entire additions directory structure to Node.js source.
  await cp(ADDITIONS_DIR, NODE_DIR, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })

  getDefaultLogger().log(
    `✅ Copied ${ADDITIONS_DIR.replace(`${ROOT_DIR}/`, '')}/ → ${NODE_DIR}/`,
  )
  getDefaultLogger().log('')
}

/**
 * Embed Socket security bootstrap in VM-based loader patch.
 * This creates a dynamic patch that loads the bootstrap using Module.wrap() + VM,
 * which supports async code (unlike direct require()).
 * (Optional - only runs if bootstrap file exists)
 */
async function embedSocketSecurityBootstrap() {
  // Use transformed bootstrap from bootstrap package (compatible with Node.js internal bootstrap context).
  const bootstrapSource = join(ROOT_DIR, '..', 'bootstrap', 'dist', 'bootstrap-smol.js')

  // Auto-build bootstrap if missing.
  if (!existsSync(bootstrapSource)) {
    getDefaultLogger().log('')
    getDefaultLogger().info(`Bootstrap not found at: ${bootstrapSource}`)
    getDefaultLogger().info(`Building @socketsecurity/bootstrap package...`)
    getDefaultLogger().log('')

    const result = await spawn(
      'pnpm',
      ['--filter', '@socketsecurity/bootstrap', 'run', 'build'],
      {
        cwd: join(ROOT_DIR, '../..'),
        shell: WIN32,
        stdio: 'inherit',
      }
    )

    if (result.code !== 0) {
      throw new Error(`Failed to build @socketsecurity/bootstrap package (exit code ${result.code})`)
    }

    // Verify bootstrap was built.
    if (!existsSync(bootstrapSource)) {
      // Try to show what files exist to help diagnose.
      getDefaultLogger().error(`Bootstrap file not found at: ${bootstrapSource}`)
      getDefaultLogger().info(`Checking for bootstrap files...`)

      const bootstrapDir = dirname(bootstrapSource)
      if (existsSync(bootstrapDir)) {
        getDefaultLogger().info(`Directory exists: ${bootstrapDir}`)
        try {
          const files = await readdir(bootstrapDir)
          getDefaultLogger().info(`Files in directory: ${files.join(', ')}`)
        } catch (e) {
          getDefaultLogger().warn(`Could not list directory contents`)
        }
      } else {
        getDefaultLogger().error(`Directory does not exist: ${bootstrapDir}`)
      }

      throw new Error(`Bootstrap build succeeded but dist file not found at: ${bootstrapSource}`)
    }

    getDefaultLogger().log('')
  }

  printHeader('Embedding Socket Security Bootstrap in VM-Based Loader')

  // Read the bootstrap code.
  const bootstrapCode = await readFile(bootstrapSource, 'utf8')
  const bootstrapSize = Buffer.byteLength(bootstrapCode, 'utf8')

  // Base64 encode the bootstrap (will be decoded at runtime in Node.js).
  const bootstrapB64 = Buffer.from(bootstrapCode, 'utf8').toString('base64')
  const bootstrapB64Size = bootstrapB64.length

  getDefaultLogger().log(`📦 Bootstrap size: ${(bootstrapSize / 1024).toFixed(1)}KB`)
  getDefaultLogger().log(`📦 Base64 encoded: ${(bootstrapB64Size / 1024).toFixed(1)}KB`)

  // Split base64 into chunks to avoid git patch line length limits.
  // Git apply can fail with "corrupt patch" errors if lines are too long.
  const chunkSize = 80
  const base64Chunks = []
  for (let i = 0; i < bootstrapB64.length; i += chunkSize) {
    base64Chunks.push(bootstrapB64.slice(i, i + chunkSize))
  }

  // Format as multi-line JavaScript string concatenation.
  // Each line must start with proper indentation for the patch format.
  // IMPORTANT: Each line needs a '+' prefix for patch format!
  const base64MultiLine = base64Chunks
    .map((chunk, index) => {
      if (index === 0) {
        return `'${chunk}'`
      }
      // Continuation lines: patch '+' prefix + 6 spaces indentation + content
      return `+      '${chunk}'`
    })
    .join(' +\n')

  // Read the patch template.
  const patchTemplatePath = join(PATCHES_DIR, 'load-socketsecurity-bootstrap-v24-preexec.template.patch')
  const patchTemplate = await readFile(patchTemplatePath, 'utf8')

  // Embed the bootstrap in the patch template.
  let finalPatch = patchTemplate.replace(
    'SOCKET_BOOTSTRAP_BASE64_PLACEHOLDER',
    base64MultiLine
  )

  // Fix the hunk header to reflect actual line counts after base64 expansion.
  // The template has a placeholder hunk size, but the actual patch is much larger.
  const hunkLines = finalPatch.split('\n')
  let addedLines = 0
  let contextLines = 0
  let inHunk = false

  for (const line of hunkLines) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue

    if (line.startsWith('+')) addedLines++
    else if (line.startsWith(' ')) contextLines++
    else if (line.startsWith('-')) {} // removed lines (none in our case)
  }

  // New file will have: context lines + added lines
  const newFileLines = contextLines + addedLines

  // Update the hunk header: @@ -oldStart,oldLines +newStart,newLines @@
  finalPatch = finalPatch.replace(
    /@@ -(\d+),(\d+) \+(\d+),(\d+) @@/,
    `@@ -$1,$2 +$3,${newFileLines} @@`
  )

  getDefaultLogger().log(`📊 Patch statistics:`)
  getDefaultLogger().log(`   Added lines: ${addedLines}`)
  getDefaultLogger().log(`   Context lines: ${contextLines}`)
  getDefaultLogger().log(`   Total new file lines: ${newFileLines}`)

  // Write the final patch to build/patches/ (will be applied during patching phase).
  const buildPatchesDir = join(BUILD_DIR, 'patches')
  await mkdir(buildPatchesDir, { recursive: true })

  const finalPatchPath = join(buildPatchesDir, 'load-socketsecurity-bootstrap-v24-preexec.patch')
  await writeFile(finalPatchPath, finalPatch, 'utf8')

  getDefaultLogger().log(`✅ Generated dynamic patch: ${finalPatchPath.replace(`${ROOT_DIR}/`, '')}`)
  getDefaultLogger().log(`   ${(finalPatch.length / 1024).toFixed(1)}KB (includes embedded bootstrap)`)
  getDefaultLogger().log(`   Uses Module.wrap() + VM approach (supports async code!)`)
  getDefaultLogger().log('')
}

const CPU_COUNT = cpus().length
const IS_MACOS = TARGET_PLATFORM === 'darwin'
const IS_WINDOWS = TARGET_PLATFORM === 'win32'
const ARCH = TARGET_ARCH

/**
 * Check if Node.js source has uncommitted changes.
 */
async function isNodeSourceDirty() {
  try {
    const status = await execCapture('git status --porcelain', {
      cwd: NODE_DIR,
    })
    return status.stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Reset Node.js source to pristine state.
 */
async function resetNodeSource() {
  getDefaultLogger().log('Fetching latest tags...')
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
  getDefaultLogger().log('Resetting to clean state...')
  await exec('git', ['reset', '--hard', NODE_VERSION], { cwd: NODE_DIR })
  await exec('git', ['clean', '-fdx'], { cwd: NODE_DIR })
  getDefaultLogger().log(`${colors.green('✓')} Node.js source reset to clean state`)
  getDefaultLogger().log('')
}

/**
 * Get file size in human-readable format.
 */
async function getFileSize(filePath) {
  const result = await execCapture(`du -h "${filePath}"`)
  return result.stdout.split('\t')[0]
}

/**
 * Check if required tools are available, auto-installing if possible.
 */
async function checkRequiredTools() {
  printHeader('Pre-flight Checks')

  // Step 1: Ensure package manager is available.
  const pmResult = await ensurePackageManagerAvailable({
    autoInstall: AUTO_YES,
    autoYes: AUTO_YES,
  })

  const canAutoInstall = pmResult.available

  if (pmResult.installed) {
    getDefaultLogger().success(`Package manager (${pmResult.manager}) installed successfully`)
  } else if (pmResult.available) {
    getDefaultLogger().log(`📦 Package manager detected: ${pmResult.manager}`)
  } else {
    getDefaultLogger().warn('No package manager available for auto-installing tools')
    const pmInstructions = getPackageManagerInstructions()
    for (const instruction of pmInstructions) {
      getDefaultLogger().substep(instruction)
    }
  }

  // Step 2: Tools that support auto-installation.
  const autoInstallableTools = ['git', 'curl', 'patch', 'make']

  // Step 3: Tools that must be checked manually (no package manager support).
  const manualTools = [
    // macOS strip doesn't support --version, just check if it exists.
    { name: 'strip', cmd: 'strip', checkExists: true },
  ]

  if (IS_MACOS && ARCH === 'arm64') {
    // macOS codesign doesn't support --version, just check if it exists.
    manualTools.push({
      name: 'codesign',
      cmd: 'codesign',
      checkExists: true,
    })
  }

  // Step 4: Attempt auto-installation for missing tools.
  const result = await ensureAllToolsInstalled(autoInstallableTools, {
    autoInstall: canAutoInstall,
    autoYes: AUTO_YES,
  })

  // Step 5: Report results.
  for (const tool of autoInstallableTools) {
    if (result.installed.includes(tool)) {
      getDefaultLogger().success(`${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      getDefaultLogger().log(`${colors.green('✓')} ${tool} is available`)
    }
  }

  // Step 6: Check manual tools.
  let allManualAvailable = true
  for (const { checkExists, cmd, name } of manualTools) {
    const binPath = whichBinSync(cmd, { nothrow: true })
    if (binPath) {
      getDefaultLogger().log(`${colors.green('✓')} ${name} is available`)
    } else {
      getDefaultLogger().error(`${colors.red('✗')} ${name} is NOT available`)
      allManualAvailable = false
    }
  }

  // Step 7: Handle missing tools.
  if (!result.allAvailable || !allManualAvailable) {
    const missingTools = [...result.missing, ...manualTools.filter(t => !whichBinSync(t.cmd, { nothrow: true })).map(t => t.name)]

    if (missingTools.length > 0) {
      const instructions = []
      instructions.push('Missing required build tools:')
      instructions.push('')

      for (const tool of missingTools) {
        const toolInstructions = getInstallInstructions(tool)
        instructions.push(...toolInstructions)
        instructions.push('')
      }

      if (IS_MACOS) {
        instructions.push('For Xcode Command Line Tools:')
        instructions.push('  xcode-select --install')
      }

      printError('Missing Required Tools', 'Some required build tools are not available.', instructions)
      throw new Error('Missing required build tools')
    }
  }

  getDefaultLogger().log('')
}

/**
 * Check build environment (Python, compiler, disk space, network).
 */
async function checkBuildEnvironment() {
  printHeader('Build Environment Checks')

  let allChecks = true

  // Check 1: Disk space.
  getDefaultLogger().log('Checking available disk space...')
  const diskSpace = await checkDiskSpace(BUILD_DIR)
  if (diskSpace.availableGB !== null) {
    if (diskSpace.sufficient) {
      getDefaultLogger().success(
        `Disk space: ${diskSpace.availableGB}GB available (need 5GB)`,
      )
    } else {
      getDefaultLogger().fail(
        `Disk space: Only ${diskSpace.availableGB}GB available (need 5GB)`,
      )
      getDefaultLogger().substep('Free up disk space before building')
      allChecks = false
    }
  } else {
    getDefaultLogger().warn('Could not check disk space (continuing anyway)')
  }

  // Check 2: Python version.
  getDefaultLogger().log('Checking Python version...')
  const python = await checkPythonVersion()
  if (python.available && python.sufficient) {
    getDefaultLogger().success(`Python ${python.version} is available`)
  } else if (python.available && !python.sufficient) {
    getDefaultLogger().fail(`Python ${python.version} is too old (need Python 3.6+)`)
    allChecks = false
  } else {
    getDefaultLogger().fail('Python is not available')
    getDefaultLogger().substep('Node.js build requires Python 3.6 or later')
    allChecks = false
  }

  // Check 3: C++ compiler.
  getDefaultLogger().log('Checking C++ compiler...')
  const compiler = await checkCompiler()
  if (compiler.available) {
    getDefaultLogger().success(`C++ compiler (${compiler.compiler}) is available`)
  } else {
    getDefaultLogger().fail('C++ compiler is not available')
    getDefaultLogger().substep('Node.js build requires clang++, g++, or c++')
    allChecks = false
  }

  // Check 4: Network connectivity.
  getDefaultLogger().log('Checking network connectivity...')
  const network = await checkNetworkConnectivity()
  if (network.connected) {
    getDefaultLogger().success('Network connection to GitHub is working')
  } else {
    getDefaultLogger().fail('Cannot reach GitHub')
    getDefaultLogger().substep('Check your internet connection')
    allChecks = false
  }

  getDefaultLogger().logNewline()

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

  getDefaultLogger().success('Build environment is ready')
  getDefaultLogger().logNewline()
}

/**
 * Verify Socket modifications were applied correctly.
 */
async function verifySocketModifications() {
  printHeader('Verifying Socket Modifications')

  let allApplied = true

  // Check 1: lib/sea.js modification.
  getDefaultLogger().log('Checking lib/sea.js modification...')
  const seaFile = join(NODE_DIR, 'lib', 'sea.js')
  try {
    const content = await readFile(seaFile, 'utf8')
    if (content.includes('const isSea = () => true;')) {
      getDefaultLogger().success('lib/sea.js correctly modified (SEA override applied)')
    } else {
      getDefaultLogger().fail('lib/sea.js modification FAILED')
      getDefaultLogger().substep('Expected: const isSea = () => true;')
      allApplied = false
    }
  } catch (e) {
    getDefaultLogger().fail(`Cannot read lib/sea.js: ${e.message}`)
    allApplied = false
  }

  // Check 2: V8 include paths (v24.10.0+ doesn't need fixes).
  getDefaultLogger().log('Checking V8 include paths...')
  const testFile = join(NODE_DIR, 'deps/v8/src/heap/cppgc/heap-page.h')
  try {
    const content = await readFile(testFile, 'utf8')
    // For v24.10.0+, the CORRECT include has "src/" prefix.
    if (content.includes('#include "src/base/iterator.h"')) {
      getDefaultLogger().success(
        'V8 include paths are correct (no modification needed for v24.10.0+)',
      )
    } else if (content.includes('#include "base/iterator.h"')) {
      getDefaultLogger().fail('V8 include paths were incorrectly modified!')
      getDefaultLogger().substep('v24.10.0+ needs "src/" prefix in includes')
      getDefaultLogger().substep('Build will fail - source was corrupted')
      allApplied = false
    } else {
      getDefaultLogger().warn('V8 include structure may have changed (cannot verify)')
    }
  } catch (e) {
    getDefaultLogger().warn(`Cannot verify V8 includes: ${e.message}`)
  }

  // Check 3: localeCompare polyfill (kept as safety layer with small-icu).
  getDefaultLogger().log('Checking localeCompare polyfill...')
  const primordialFile = join(
    NODE_DIR,
    'lib',
    'internal',
    'per_context',
    'primordials.js',
  )
  try {
    const content = await readFile(primordialFile, 'utf8')
    if (content.includes('Socket CLI: Polyfill localeCompare')) {
      getDefaultLogger().success(
        'primordials.js correctly modified (localeCompare polyfill)',
      )
    } else {
      getDefaultLogger().warn('localeCompare polyfill not applied (may not be needed with small-icu)')
    }
  } catch (e) {
    getDefaultLogger().warn(`Cannot verify primordials.js: ${e.message}`)
  }

  // Check 4: String.prototype.normalize polyfill (kept as safety layer with small-icu).
  getDefaultLogger().log('Checking normalize polyfill...')
  const bootstrapFile = join(
    NODE_DIR,
    'lib',
    'internal',
    'bootstrap',
    'node.js',
  )
  try {
    const content = await readFile(bootstrapFile, 'utf8')
    if (content.includes('Socket CLI: Polyfill String.prototype.normalize')) {
      getDefaultLogger().success(
        'bootstrap/node.js correctly modified (normalize polyfill)',
      )
    } else {
      getDefaultLogger().warn('normalize polyfill not applied (may not be needed with small-icu)')
    }
  } catch (e) {
    getDefaultLogger().warn(`Cannot verify bootstrap/node.js: ${e.message}`)
  }

  getDefaultLogger().logNewline()

  if (!allApplied) {
    printError(
      'Socket Modifications Not Applied',
      'Critical Socket modifications were not applied to Node.js source.',
      [
        'This is a BUG in the build script',
        'The binary will NOT work correctly with pkg',
        'Run: node scripts/build-custom-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Socket modifications verification failed')
  }

  getDefaultLogger().success(
    'All Socket modifications verified for --with-intl=small-icu',
  )
  getDefaultLogger().logNewline()
}

/**
 * Apply Socket modifications for --with-intl=none compatibility.
 *
 * These source transforms help ensure Node.js APIs work correctly
 * when compiled without ICU (International Components for Unicode).
 */
// Function removed: applySocketModificationsDirectly().
// Socket modifications must be applied via patches only.
// If patches fail, the build should fail with helpful error messages.


/**
 * Main build function.
 */
async function main() {
  getDefaultLogger().log('')
  getDefaultLogger().log('🔨 Socket CLI - Custom Node.js Builder')
  getDefaultLogger().log(`   Building Node.js ${NODE_VERSION} with custom patches`)
  getDefaultLogger().log('')

  // Start timing total build.
  const totalStart = Date.now()

  // Initialize build log.
  await saveBuildLog(BUILD_DIR, '━'.repeat(60))
  await saveBuildLog(BUILD_DIR, '  Socket CLI - Custom Node.js Builder')
  await saveBuildLog(BUILD_DIR, `  Node.js ${NODE_VERSION} with custom patches`)
  await saveBuildLog(BUILD_DIR, `  Started: ${new Date().toISOString()}`)
  await saveBuildLog(BUILD_DIR, '━'.repeat(60))
  await saveBuildLog(BUILD_DIR, '')

  // Phase 1: Pre-flight checks.
  await saveBuildLog(BUILD_DIR, 'Phase 1: Pre-flight Checks')
  await checkRequiredTools()
  await checkBuildEnvironment()
  await saveBuildLog(BUILD_DIR, 'Pre-flight checks completed')
  await saveBuildLog(BUILD_DIR, '')

  // Ensure build directory exists.
  await mkdir(BUILD_DIR, { recursive: true })

  // Check if we can use cached build (skip if --clean).
  if (!CLEAN_BUILD) {
    const distributionOutputBinary = join(BUILD_DIR, 'out', 'Distribution', IS_WINDOWS ? 'node.exe' : 'node')
    const distBinary = join(ROOT_DIR, 'dist', 'socket-smol')

    // Collect all source files that affect the build.
    const sourcePaths = collectBuildSourceFiles()

    // Check if build is needed based on source file hashes.
    // Store hash in centralized build/.cache/ directory.
    const cacheDir = join(BUILD_DIR, '.cache')
    const hashFilePath = join(cacheDir, 'node.hash')
    const needsExtraction = await shouldExtract({
      sourcePaths,
      outputPath: hashFilePath,
      validateOutput: () => {
        // Verify both distribution binary, hash file, and dist binary exist.
        return existsSync(distributionOutputBinary) &&
               existsSync(hashFilePath) &&
               existsSync(distBinary)
      },
    })

    if (!needsExtraction) {
      // Cache hit! Binary is up to date.
      getDefaultLogger().log('')
      printHeader('✅ Using Cached Build')
      getDefaultLogger().log('All source files unchanged since last build.')
      getDefaultLogger().log('')
      getDefaultLogger().substep(`Distribution binary: ${distributionOutputBinary}`)
      getDefaultLogger().substep(`E2E binary: ${distBinary}`)
      getDefaultLogger().log('')
      getDefaultLogger().success('Cached build is ready to use')
      getDefaultLogger().log('')
      return
    }
  }

  // Phase 3: Verify Git tag exists before cloning.
  printHeader('Verifying Node.js Version')
  getDefaultLogger().log(`Checking if ${NODE_VERSION} exists in Node.js repository...`)
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
  getDefaultLogger().log(`${colors.green('✓')} ${NODE_VERSION} exists in Node.js repository`)
  getDefaultLogger().log('')

  // Clone or reset Node.js repository.
  if (!existsSync(NODE_DIR) || CLEAN_BUILD) {
    if (existsSync(NODE_DIR) && CLEAN_BUILD) {
      printHeader('Clean Build Requested')
      getDefaultLogger().log('Removing existing Node.js source directory...')
      const { rm } = await import('node:fs/promises')
      await rm(NODE_DIR, { recursive: true, force: true })
      await cleanCheckpoint(BUILD_DIR)
      getDefaultLogger().log(`${colors.green('✓')} Cleaned build directory`)
      getDefaultLogger().log('')
    }

    printHeader('Cloning Node.js Source')
    getDefaultLogger().log(`Version: ${NODE_VERSION}`)
    getDefaultLogger().log('Repository: https://github.com/nodejs/node.git')
    getDefaultLogger().log('')
    getDefaultLogger().info('This will download ~200-300 MB (shallow clone with --depth=1 --single-branch)...')
    getDefaultLogger().log('Retry: Up to 3 attempts if clone fails')
    getDefaultLogger().log('')

    // Git clone with retry (network can fail during long downloads).
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          getDefaultLogger().log(`Retry attempt ${attempt}/3...`)
          getDefaultLogger().log('')
        }

        await exec(
          'git',
          [
            'clone',
            '--depth',
            '1',
            '--single-branch',
            '--branch',
            NODE_VERSION,
            'https://github.com/nodejs/node.git',
            NODE_DIR,
          ],
          { cwd: ROOT_DIR },
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
              `  cd ${ROOT_DIR}`,
              `  git clone --depth 1 --branch ${NODE_VERSION} https://github.com/nodejs/node.git ${NODE_DIR}`,
            ],
          )
          throw new Error('Git clone failed after retries')
        }

        getDefaultLogger().warn(`${colors.yellow('⚠')} Clone attempt ${attempt} failed: ${e.message}`)

        // Clean up partial clone.
        try {
          const { rm } = await import('node:fs/promises')
          await rm(NODE_DIR, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors.
        }

        // Wait before retry.
        const waitTime = 2000 * attempt
        getDefaultLogger().log(`${colors.blue('ℹ')} Waiting ${waitTime}ms before retry...`)
        getDefaultLogger().log('')
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      getDefaultLogger().log(`${colors.green('✓')} Node.js source cloned successfully`)
      await createCheckpoint(BUILD_DIR, 'cloned')
      getDefaultLogger().log('')
    }
  } else {
    printHeader('Using Existing Node.js Source')

    // Check if source has uncommitted changes.
    const isDirty = await isNodeSourceDirty()
    if (isDirty && !AUTO_YES) {
      printWarning(
        'Node.js Source Has Uncommitted Changes',
        'The build/node-source directory has uncommitted changes from a previous build or crash.',
        [
          'These changes will be discarded to ensure a clean build',
          'Press Ctrl+C now if you want to inspect the changes first',
          'Or wait 5 seconds to continue with automatic reset...',
        ],
      )

      // Wait 5 seconds before proceeding.
      await new Promise(resolve => setTimeout(resolve, 5000))
      getDefaultLogger().log('')
    } else if (isDirty && AUTO_YES) {
      getDefaultLogger().log(
        '⚠️  Node.js source has uncommitted changes (auto-resetting with --yes)',
      )
      getDefaultLogger().log('')
    }

    await resetNodeSource()
  }

  // Copy build additions before applying patches.
  await copyBuildAdditions()

  // Embed Socket security bootstrap in VM-based loader patch.
  // This creates a dynamic patch that supports async code execution.
  await embedSocketSecurityBootstrap()

  // Apply Socket patches (including the dynamically generated bootstrap loader).
  const socketPatches = findSocketPatches()

  if (socketPatches.length > 0) {
    // Validate Socket patches before applying.
    printHeader('Validating Socket Patches')
    getDefaultLogger().log(`Found ${socketPatches.length} patch(es) for ${NODE_VERSION}`)
    getDefaultLogger().log('Checking integrity, compatibility, and conflicts...')
    getDefaultLogger().log('')

    const patchData = []
    let allValid = true

    for (const patch of socketPatches) {
      getDefaultLogger().group(` ${colors.blue('ℹ')}   Validating ${patch.name}`)

      const isValid = await validatePatch(patch.path, NODE_DIR)
      if (!isValid) {
        getDefaultLogger().error(`${colors.red('✗')} INVALID: Patch validation failed`)
        getDefaultLogger().groupEnd()
        allValid = false
        continue
      }

      const content = await readFile(patch.path, 'utf8')
      const analysis = analyzePatchContent(content)

      patchData.push({
        name: patch.name,
        path: patch.path,
        analysis,
      })
      if (analysis.modifiesV8Includes) {
        getDefaultLogger().log(`${colors.green('✓')} Modifies V8 includes`)
      }
      if (analysis.modifiesSEA) {
        getDefaultLogger().log(`${colors.green('✓')} Modifies SEA detection`)
      }
      getDefaultLogger().log(`${colors.green('✓')} Valid`)
      getDefaultLogger().groupEnd()
    }

    if (!allValid) {
      throw new Error(
        'Socket patch validation failed.\n\n' +
          `One or more Socket patches are invalid or incompatible with Node.js ${NODE_VERSION}.\n\n` +
          'Possible causes:\n' +
          '  - Patch files are corrupted\n' +
          `  - Patches don't match this Node.js version\n` +
          '  - Node.js source has unexpected modifications\n\n' +
          'To fix:\n' +
          `  1. Verify patch files in ${PATCHES_DIR}\n` +
          '  2. Regenerate patches if needed:\n' +
          `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
          '  3. Check build/patches/README.md for patch creation guide',
      )
    }
    // Check for conflicts between patches.
    const conflicts = checkPatchConflicts(patchData, NODE_VERSION)
    if (conflicts.length > 0) {
      getDefaultLogger().warn(`${colors.yellow('⚠')} Patch Conflicts Detected:`)
      getDefaultLogger().warn()
      for (const conflict of conflicts) {
        if (conflict.severity === 'error') {
          getDefaultLogger().error(`  ${colors.red('✗')} ERROR: ${conflict.message}`)
          allValid = false
        } else {
          getDefaultLogger().warn(`  ${colors.yellow('⚠')} WARNING: ${conflict.message}`)
        }
      }
      getDefaultLogger().warn()

      if (!allValid) {
        throw new Error(
          'Critical patch conflicts detected.\n\n' +
            `Socket patches have conflicts and cannot be applied to Node.js ${NODE_VERSION}.\n\n` +
            'Conflicts found:\n' +
            conflicts
              .filter(c => c.severity === 'error')
              .map(c => `  - ${c.message}`)
              .join('\n') +
            '\n\n' +
            'To fix:\n' +
            '  1. Remove conflicting patches\n' +
            `  2. Use version-specific patches for ${NODE_VERSION}\n` +
            '  3. Regenerate patches:\n' +
            `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
            '  4. See build/patches/socket/README.md for guidance',
        )
      }
    } else {
      getDefaultLogger().log(`${colors.green('✓')} All Socket patches validated successfully`)
      getDefaultLogger().log(`${colors.green('✓')} No conflicts detected`)
      getDefaultLogger().log('')
    }

    // Patches validated successfully, ready to apply.

    // Apply patches if validation and dry-run passed.
    if (allValid) {
      printHeader('Applying Socket Patches')
      for (const { name, path: patchPath } of patchData) {
        getDefaultLogger().log(`Applying ${name}...`)
        try {
          // Use -p1 to match Git patch format (strips a/ and b/ prefixes).
          // Use --batch to avoid interactive prompts.
          // Use --forward to skip if already applied.
          await exec(
            'sh',
            ['-c', `patch -p1 --batch --forward < "${patchPath}"`],
            { cwd: NODE_DIR },
          )
          getDefaultLogger().log(`${colors.green('✓')} ${name} applied`)
        } catch (e) {
          throw new Error(
            'Socket patch application failed.\n\n' +
              `Failed to apply patch: ${name}\n` +
              `Node.js version: ${NODE_VERSION}\n` +
              `Patch path: ${patchPath}\n\n` +
              `Error: ${e.message}\n\n` +
              'This usually means:\n' +
              '  - The patch is outdated for this Node.js version\n' +
              '  - Node.js source has unexpected modifications\n' +
              '  - Patch file format is invalid\n\n' +
              'To fix:\n' +
              '  1. Verify Node.js source is clean\n' +
              '  2. Regenerate patches:\n' +
              `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
              '  3. See build/patches/README.md for troubleshooting',
          )
        }
      }
      getDefaultLogger().log(`${colors.green('✓')} All Socket patches applied successfully`)
      getDefaultLogger().log('')
    }
  } else {
    throw new Error(
      `No Socket patches found for Node.js ${NODE_VERSION}.\n\n` +
        `Expected patches in: ${PATCHES_DIR}\n\n` +
        'Socket patches are required for all Node.js builds. Patches must exist before building.\n\n' +
        'To fix:\n' +
        `  1. Create patches for ${NODE_VERSION}:\n` +
        `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
        '  2. See build/patches/README.md for patch creation guide\n' +
        '  3. Patches must be committed to the repository before building\n\n' +
        'Note: For new Node.js versions, you must create patches following the standard\n' +
        'patch creation process documented in build/patches/README.md',
    )
  }

  // Verify modifications were applied.
  await verifySocketModifications()

  // Configure Node.js with optimizations.
  printHeader('Configuring Node.js Build')

  if (IS_DEV_BUILD) {
    getDefaultLogger().log(`${colors.cyan('🚀 DEV BUILD MODE')} - Fast builds, larger binaries`)
    getDefaultLogger().log('')
    getDefaultLogger().log('Optimization flags:')
    getDefaultLogger().log(
      `  ${colors.green('✓')} KEEP: Full V8 (TurboFan JIT), WASM, SSL/crypto`,
    )
    getDefaultLogger().log(
      `  ${colors.green('✓')} REMOVE: npm, corepack, inspector, amaro, sqlite, SEA`,
    )
    getDefaultLogger().log(
      `  ${colors.green('✓')} DISABLED: LTO (Link Time Optimization) for faster builds`,
    )
    getDefaultLogger().log(
      `  ${colors.green('✓')} DISABLED: V8 Lite Mode for faster JS execution`,
    )
    getDefaultLogger().log('')
    getDefaultLogger().log(
      'Expected binary size: ~80-90MB (before stripping), ~40-50MB (after)',
    )
    getDefaultLogger().log('Expected build time: ~50% faster than production builds')
  } else {
    getDefaultLogger().log(`${colors.magenta('⚡ PRODUCTION BUILD MODE')} - Optimized for size/distribution`)
    getDefaultLogger().log('')
    getDefaultLogger().log('Optimization flags:')
    getDefaultLogger().log(
      `  ${colors.green('✓')} KEEP: V8 Lite Mode (baseline compiler), WASM (Liftoff), SSL/crypto`,
    )
    getDefaultLogger().log(
      `  ${colors.green('✓')} REMOVE: npm, corepack, inspector, amaro, sqlite, SEA, ICU, TurboFan JIT`,
    )
    getDefaultLogger().log(`  ${colors.green('✓')} ICU: none (no internationalization, saves ~6-8 MB)`)
    getDefaultLogger().log(
      `  ${colors.green('✓')} V8 Lite Mode: Disables TurboFan optimizer (saves ~15-20 MB)`,
    )
    getDefaultLogger().log(
      `  ${colors.green('✓')} OPTIMIZATIONS: no-snapshot, with-code-cache (for errors), no-SEA, V8 Lite, LTO`,
    )
    getDefaultLogger().log('')
    getDefaultLogger().log(
      `  ${colors.green('✓')} V8 LITE MODE: JavaScript runs 5-10x slower (CPU-bound code)`,
    )
    getDefaultLogger().log(`  ${colors.green('✓')} WASM: Full speed (uses Liftoff compiler, unaffected)`)
    getDefaultLogger().log(`  ${colors.green('✓')} I/O: No impact (network, file operations)`)
    getDefaultLogger().log('')
    getDefaultLogger().log(
      'Expected binary size: ~60MB (before stripping), ~23-27MB (after)',
    )
  }
  getDefaultLogger().log('')

  const configureFlags = [
    '--ninja', // Use Ninja build system (faster parallel builds than make)
    '--with-intl=small-icu', // -5 MB: English-only ICU (supports Unicode property escapes)
    // Note: small-icu provides essential Unicode support while keeping binary small
    '--without-npm',
    '--without-corepack',
    '--without-inspector',
    '--without-amaro',
    '--without-sqlite',
    '--without-node-snapshot',
    '--without-node-code-cache', // Enable code cache (prevents error info dump).
    // Note: --v8-disable-object-print disabled to enable proper error output.
    // '--v8-disable-object-print',
    '--without-node-options',
    '--disable-single-executable-application', // -1-2 MB: SEA not needed for pkg
  ]

  // Production-only optimizations (slow builds, smaller binaries).
  if (IS_PROD_BUILD) {
    configureFlags.push('--v8-lite-mode') // -15-20 MB: Disables TurboFan JIT (JS slower, WASM unaffected)
    configureFlags.push('--enable-lto') // Link Time Optimization (very slow, saves ~5-10MB)
  }

  // Add architecture flag for cross-compilation or explicit targeting.
  if (ARCH === 'arm64') {
    configureFlags.unshift('--dest-cpu=arm64')
  } else if (ARCH === 'x64') {
    configureFlags.unshift('--dest-cpu=x64')
  }

  getDefaultLogger().log('::group::Running ./configure')
  await exec('./configure', configureFlags, { cwd: NODE_DIR })
  getDefaultLogger().log('::endgroup::')
  getDefaultLogger().log(`${colors.green('✓')} Configuration complete`)
  getDefaultLogger().log('')

  // Build Node.js.
  printHeader('Building Node.js')

  const timeEstimate = estimateBuildTime(CPU_COUNT)
  getDefaultLogger().log(
    `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
  )
  getDefaultLogger().log(`🚀 Using ${CPU_COUNT} CPU cores for parallel compilation`)
  getDefaultLogger().log('')
  getDefaultLogger().log('You can:')
  getDefaultLogger().log('  • Grab coffee ☕')
  getDefaultLogger().log('  • Work on other tasks')
  getDefaultLogger().log('  • Watch progress in this terminal (but seriously, go touch grass)')
  getDefaultLogger().log('')
  getDefaultLogger().log(`Build log: ${getBuildLogPath(BUILD_DIR)}`)
  getDefaultLogger().log('')
  getDefaultLogger().log('Starting build...')
  getDefaultLogger().log('')

  const buildStart = Date.now()

  // Use GitHub Actions grouping to collapse compiler output.
  getDefaultLogger().log('::group::Compiling Node.js with Ninja (this will take a while...)')

  try {
    await exec('ninja', ['-C', 'out/Release', `-j${CPU_COUNT}`], { cwd: NODE_DIR })
    getDefaultLogger().log('::endgroup::')
  } catch (e) {
    getDefaultLogger().log('::endgroup::')
    // Build failed - show last 50 lines of build log.
    const lastLines = await getLastLogLines(BUILD_DIR, 50)
    if (lastLines) {
      getDefaultLogger().error()
      getDefaultLogger().error('Last 50 lines of build log:')
      getDefaultLogger().error('━'.repeat(60))
      getDefaultLogger().error(lastLines)
      getDefaultLogger().error('━'.repeat(60))
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
        'Try again with: node scripts/build-custom-node.mjs --clean',
      ],
    )
    throw e
  }

  const buildDuration = Date.now() - buildStart
  const buildTime = formatDuration(buildDuration)

  getDefaultLogger().log('')
  getDefaultLogger().log(`${colors.green('✓')} Build completed in ${buildTime}`)
  await createCheckpoint(BUILD_DIR, 'built')
  getDefaultLogger().log('')

  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')

  // Sign early for macOS ARM64 (required before execution in CI).
  if (IS_MACOS && ARCH === 'arm64') {
    printHeader('Code Signing (macOS ARM64 - Initial)')
    getDefaultLogger().log('Signing binary before testing for macOS ARM64 compatibility...')
    getDefaultLogger().logNewline()
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])
    getDefaultLogger().success('Binary signed successfully')
    getDefaultLogger().logNewline()
  }

  // Test the binary.
  printHeader('Testing Binary')

  getDefaultLogger().log('Running basic functionality tests...')
  getDefaultLogger().log('')

  await exec(nodeBinary, ['--version'])

  await exec(nodeBinary, [
    '-e',
    `console.log("${colors.green('✓')} Binary can execute JavaScript")`,
  ])

  getDefaultLogger().log('')
  getDefaultLogger().log(`${colors.green('✓')} Binary is functional`)
  getDefaultLogger().log('')

  // Copy unmodified binary to build/out/Release.
  printHeader('Copying to Build Output (Release)')
  getDefaultLogger().log('Copying unmodified binary to build/out/Release directory...')
  getDefaultLogger().logNewline()

  const outputReleaseDir = join(BUILD_DIR, 'out', 'Release')
  await mkdir(outputReleaseDir, { recursive: true })
  const outputReleaseBinary = join(outputReleaseDir, 'node')
  await exec('cp', [nodeBinary, outputReleaseBinary])

  getDefaultLogger().substep(`Release directory: ${outputReleaseDir}`)
  getDefaultLogger().substep('Binary: node (unmodified)')
  getDefaultLogger().logNewline()
  getDefaultLogger().success('Unmodified binary copied to build/out/Release')
  getDefaultLogger().logNewline()

  // Strip debug symbols to reduce size.
  printHeader('Optimizing Binary Size')
  const sizeBeforeStrip = await getFileSize(nodeBinary)
  getDefaultLogger().log(`Size before stripping: ${sizeBeforeStrip}`)
  getDefaultLogger().log('Removing debug symbols and unnecessary sections...')
  getDefaultLogger().log('')
  await exec('strip', ['--strip-all', nodeBinary])
  const sizeAfterStrip = await getFileSize(nodeBinary)
  getDefaultLogger().log(`Size after stripping: ${sizeAfterStrip}`)

  // Parse and check size.
  const sizeMatch = sizeAfterStrip.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && size >= 20 && size <= 30) {
      getDefaultLogger().log(`${colors.green('✓')} Binary size is optimal (20-30MB with V8 Lite Mode)`)
    } else if (unit === 'M' && size < 20) {
      printWarning(
        'Binary Smaller Than Expected',
        `Binary is ${sizeAfterStrip}, expected ~23-27MB.`,
        [
          'Some features may be missing',
          'Verify configure flags were applied correctly',
        ],
      )
    } else if (unit === 'M' && size > 35) {
      printWarning(
        'Binary Larger Than Expected',
        `Binary is ${sizeAfterStrip}, expected ~23-27MB.`,
        [
          'Debug symbols may not be fully stripped',
          'Configure flags may not be applied',
          'Binary will still work but will be larger',
        ],
      )
    }
  }

  getDefaultLogger().log('')

  // Smoke test binary after stripping (ensure strip didn't corrupt it).
  getDefaultLogger().log('Testing binary after stripping...')
  const smokeTest = await smokeTestBinary(nodeBinary, process.env)

  if (!smokeTest.passed) {
    printError(
      'Binary Corrupted After Stripping',
      `Binary failed smoke test: ${smokeTest.reason}`,
      [
        'Strip command may have corrupted the binary',
        'Try rebuilding: node scripts/build-custom-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary corrupted after stripping')
  }

  getDefaultLogger().log(`${colors.green('✓')} Binary functional after stripping`)
  getDefaultLogger().log('')

  // Copy stripped binary to build/out/Stripped.
  printHeader('Copying to Build Output (Stripped)')
  getDefaultLogger().log('Copying stripped binary to build/out/Stripped directory...')
  getDefaultLogger().logNewline()

  const outputStrippedDir = join(BUILD_DIR, 'out', 'Stripped')
  await mkdir(outputStrippedDir, { recursive: true })
  const outputStrippedBinary = join(outputStrippedDir, 'node')
  await exec('cp', [nodeBinary, outputStrippedBinary])

  getDefaultLogger().substep(`Stripped directory: ${outputStrippedDir}`)
  getDefaultLogger().substep('Binary: node (stripped)')
  getDefaultLogger().logNewline()
  getDefaultLogger().success('Stripped binary copied to build/out/Stripped')
  getDefaultLogger().logNewline()

  // Compress binary for smaller distribution size (DEFAULT for smol builds).
  // Uses native platform APIs (Apple Compression, liblzma, Windows Compression API) instead of UPX.
  // Benefits: 75-79% compression (vs UPX's 50-60%), works with code signing, zero AV false positives.
  // Opt-out: Set COMPRESS_BINARY=0 or COMPRESS_BINARY=false to disable compression.
  let compressedBinary = null
  const shouldCompress = process.env.COMPRESS_BINARY !== '0' && process.env.COMPRESS_BINARY !== 'false'

  if (shouldCompress) {
    printHeader('Compressing Binary for Distribution')
    getDefaultLogger().log('Compressing stripped binary using platform-specific compression...')
    getDefaultLogger().logNewline()

    const compressedDir = join(BUILD_DIR, 'out', 'Compressed')
    await mkdir(compressedDir, { recursive: true })
    compressedBinary = join(compressedDir, 'node')

    // Select compression quality based on platform.
    // macOS: LZFSE (faster) or LZMA (better compression).
    // Linux: LZMA (best for ELF).
    // Windows: LZMS (best for PE).
    const compressionQuality = IS_MACOS ? 'lzfse' : 'lzma'

    // Read socketbin package spec from actual package.json for socket-lib cache key generation.
    // Format: @socketbin/cli-{platform}-{arch}@{version}
    // This enables deterministic cache keys based on the published package.
    const socketbinPkgPath = join(dirname(ROOT_DIR), `socketbin-cli-${TARGET_PLATFORM}-${ARCH}`, 'package.json')
    let socketbinSpec = null
    try {
      const socketbinPkg = JSON.parse(await readFile(socketbinPkgPath, 'utf-8'))
      socketbinSpec = `${socketbinPkg.name}@${socketbinPkg.version}`
      getDefaultLogger().substep(`Found socketbin package: ${socketbinSpec}`)
    } catch (e) {
      getDefaultLogger().warn(`Could not read socketbin package.json at ${socketbinPkgPath}`)
      getDefaultLogger().warn('Compression will use fallback cache key generation')
    }

    getDefaultLogger().substep(`Input: ${outputStrippedBinary}`)
    getDefaultLogger().substep(`Output: ${compressedBinary}`)
    getDefaultLogger().substep(`Algorithm: ${compressionQuality.toUpperCase()}`)
    if (socketbinSpec) {
      getDefaultLogger().substep(`Spec: ${socketbinSpec}`)
    }
    getDefaultLogger().logNewline()

    const sizeBeforeCompress = await getFileSize(outputStrippedBinary)
    getDefaultLogger().log(`Size before compression: ${sizeBeforeCompress}`)
    getDefaultLogger().log('Running compression tool...')
    getDefaultLogger().logNewline()

    // Run platform-specific compression.
    const compressArgs = [
      join(ROOT_DIR, 'scripts', 'compress-binary.mjs'),
      outputStrippedBinary,
      compressedBinary,
      `--quality=${compressionQuality}`,
    ]
    if (socketbinSpec) {
      compressArgs.push(`--spec=${socketbinSpec}`)
    }
    await exec(process.execPath, compressArgs, { cwd: ROOT_DIR })

    const sizeAfterCompress = await getFileSize(compressedBinary)
    getDefaultLogger().log(`Size after compression: ${sizeAfterCompress}`)
    getDefaultLogger().logNewline()

    // Sign compressed binary (macOS ARM64 only).
    // The compressed binary wrapper is signed; decompressor extracts unsigned Node.js binary.
    if (IS_MACOS && ARCH === 'arm64') {
      getDefaultLogger().log('Signing compressed binary...')
      await exec('codesign', ['--sign', '-', '--force', compressedBinary])

      const sigInfo = await execCapture(`codesign -dv "${compressedBinary}"`, {
        env: { ...process.env, STDERR: '>&1' },
      })
      getDefaultLogger().log(sigInfo.stdout || sigInfo.stderr)
      getDefaultLogger().logNewline()
      getDefaultLogger().substep('✓ Compressed binary signed')
      getDefaultLogger().logNewline()
    }

    getDefaultLogger().substep(`Compressed directory: ${compressedDir}`)
    getDefaultLogger().substep('Binary: node (compressed)')
    getDefaultLogger().logNewline()
    getDefaultLogger().success('Binary compressed successfully')
    getDefaultLogger().logNewline()

    // Copy decompression tool to Compressed directory for distribution.
    printHeader('Bundling Decompression Tool')
    getDefaultLogger().log('Copying platform-specific decompression tool for distribution...')
    getDefaultLogger().logNewline()

    const toolsDir = join(ROOT_DIR, 'additions', 'tools')
    const decompressTool = IS_MACOS
      ? 'socket_macho_decompress'
      : WIN32
        ? 'socket_pe_decompress.exe'
        : 'socket_elf_decompress'

    const decompressToolSource = join(toolsDir, decompressTool)
    const decompressToolDest = join(compressedDir, decompressTool)

    if (existsSync(decompressToolSource)) {
      await exec('cp', [decompressToolSource, decompressToolDest])

      // Ensure tool is executable.
      await exec('chmod', ['+x', decompressToolDest])

      const toolSize = await getFileSize(decompressToolDest)
      getDefaultLogger().substep(`Tool: ${decompressTool} (${toolSize})`)
      getDefaultLogger().substep(`Location: ${compressedDir}`)
      getDefaultLogger().logNewline()
      getDefaultLogger().success('Decompression tool bundled for distribution')
      getDefaultLogger().logNewline()
    } else {
      printWarning(
        'Decompression Tool Not Found',
        `Could not find ${decompressTool} in ${toolsDir}`,
        [
          'Build the compression tools first:',
          `  cd ${toolsDir}`,
          `  make all`,
          'Then run this build again with COMPRESS_BINARY=1',
        ],
      )
    }
  } else {
    getDefaultLogger().log('')
    getDefaultLogger().log(`${colors.blue('ℹ')} Binary compression skipped (optional)`)
    getDefaultLogger().log('   To enable: COMPRESS_BINARY=1 node scripts/build.mjs')
    getDefaultLogger().log('')
  }

  // Copy final distribution binary to build/out/Final.
  // Use compressed binary if available, otherwise use stripped binary.
  printHeader('Copying to Build Output (Final)')
  const finalDir = join(BUILD_DIR, 'out', 'Final')
  await mkdir(finalDir, { recursive: true })
  const finalBinary = join(finalDir, 'node')

  if (compressedBinary && existsSync(compressedBinary)) {
    getDefaultLogger().log('Copying compressed distribution package to Final directory...')
    getDefaultLogger().logNewline()

    const compressedDir = join(BUILD_DIR, 'out', 'Compressed')

    // Copy compressed binary to Final.
    await exec('cp', [compressedBinary, finalBinary])

    // Copy decompressor tool to Final.
    const decompressTool = IS_MACOS
      ? 'socket_macho_decompress'
      : WIN32 ? 'socket_pe_decompress.exe' : 'socket_elf_decompress'
    const decompressToolSource = join(compressedDir, decompressTool)
    const decompressToolDest = join(finalDir, decompressTool)

    if (existsSync(decompressToolSource)) {
      await exec('cp', [decompressToolSource, decompressToolDest])
      await exec('chmod', ['+x', decompressToolDest])
    }

    const compressedSize = await getFileSize(finalBinary)
    const decompressToolSize = existsSync(decompressToolDest)
      ? await getFileSize(decompressToolDest)
      : 'N/A'

    getDefaultLogger().substep('Source: build/out/Compressed/node (compressed + signed)')
    getDefaultLogger().substep(`Binary: ${compressedSize}`)
    getDefaultLogger().substep(`Decompressor: ${decompressToolSize}`)
    getDefaultLogger().substep(`Location: ${finalDir}`)
    getDefaultLogger().logNewline()
    getDefaultLogger().success('Final distribution created with compressed package')
    getDefaultLogger().logNewline()
  } else {
    getDefaultLogger().log('Copying stripped binary to Final directory...')
    getDefaultLogger().logNewline()

    await exec('cp', [outputStrippedBinary, finalBinary])

    const binarySize = await getFileSize(finalBinary)
    getDefaultLogger().substep('Source: build/out/Stripped/node (stripped, uncompressed)')
    getDefaultLogger().substep(`Binary: ${binarySize}`)
    getDefaultLogger().substep(`Location: ${finalDir}`)
    getDefaultLogger().logNewline()
    getDefaultLogger().success('Final distribution created with uncompressed binary')
    getDefaultLogger().logNewline()
  }

  // Copy signed binary to build/out/Sea (for SEA builds).
  printHeader('Copying to Build Output (Sea)')
  getDefaultLogger().log(
    'Copying signed binary to build/out/Sea directory for SEA builds...',
  )
  getDefaultLogger().logNewline()

  const outputSeaDir = join(BUILD_DIR, 'out', 'Sea')
  await mkdir(outputSeaDir, { recursive: true })
  const outputSeaBinary = join(outputSeaDir, 'node')
  await exec('cp', [nodeBinary, outputSeaBinary])

  getDefaultLogger().substep(`Sea directory: ${outputSeaDir}`)
  getDefaultLogger().substep('Binary: node (stripped + signed, ready for SEA)')
  getDefaultLogger().logNewline()
  getDefaultLogger().success('Binary copied to build/out/Sea')
  getDefaultLogger().logNewline()

  // Copy to pkg cache directory (for pkg to use).
  const pkgCacheDir = join(
    process.env.HOME || process.env.USERPROFILE,
    '.pkg-cache',
    'v3.5',
  )
  const targetName = `built-${NODE_VERSION}-${TARGET_PLATFORM}-${ARCH}${IS_MACOS && ARCH === 'arm64' ? '-signed' : ''}`
  const targetPath = join(pkgCacheDir, targetName)

  printHeader('Installing to pkg Cache')
  getDefaultLogger().log('Installing binary to pkg cache...')
  getDefaultLogger().logNewline()
  getDefaultLogger().substep(`Source: ${finalBinary}`)
  getDefaultLogger().substep(`Cache directory: ${pkgCacheDir}`)
  getDefaultLogger().substep(`Binary name: ${targetName}`)
  getDefaultLogger().logNewline()

  await mkdir(pkgCacheDir, { recursive: true })
  await exec('cp', [finalBinary, targetPath])

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

  getDefaultLogger().log(`${colors.green('✓')} Binary installed to pkg cache successfully`)
  getDefaultLogger().log('')

  // Verify the cached binary works.
  printHeader('Verifying Cached Binary')
  getDefaultLogger().log('Testing that pkg can use the installed binary...')
  getDefaultLogger().log('')

  const cacheTest = await smokeTestBinary(targetPath, process.env)

  if (!cacheTest.passed) {
    printError(
      'Cached Binary Verification Failed',
      `Binary in pkg cache failed smoke test: ${cacheTest.reason}`,
      [
        'Binary may be corrupted during copy',
        'Try rebuilding with --clean flag',
        `Remove cached binary: rm ${targetPath}`,
        'Then rebuild: node scripts/build-custom-node.mjs --clean',
      ],
    )
    throw new Error('Cached binary verification failed')
  }

  getDefaultLogger().log(`${colors.green('✓')} Cached binary passed smoke test`)
  getDefaultLogger().log(`${colors.green('✓')} pkg can use this binary`)
  getDefaultLogger().log('')

  // Copy final binary to build/out/Distribution.
  printHeader('Copying Final Binary to build/out/Distribution')
  getDefaultLogger().log('Creating final distribution binary location...')
  getDefaultLogger().logNewline()

  const distributionOutputDir = join(BUILD_DIR, 'out', 'Distribution')
  await mkdir(distributionOutputDir, { recursive: true })
  const distributionOutputBinary = join(distributionOutputDir, 'node')
  await exec('cp', [finalBinary, distributionOutputBinary])

  getDefaultLogger().substep(`Distribution directory: ${distributionOutputDir}`)
  getDefaultLogger().substep('Binary: node (final distribution build)')
  getDefaultLogger().logNewline()
  getDefaultLogger().success('Final binary copied to build/out/Distribution')
  getDefaultLogger().logNewline()

  // Copy to dist/socket-smol for e2e testing.
  printHeader('Copying to dist/ for E2E Testing')
  getDefaultLogger().log('Creating dist/socket-smol for e2e test suite...')
  getDefaultLogger().logNewline()

  const distDir = join(ROOT_DIR, 'dist')
  await mkdir(distDir, { recursive: true })
  const distBinary = join(distDir, 'socket-smol')
  await exec('cp', [finalBinary, distBinary])
  await exec('chmod', ['+x', distBinary])

  getDefaultLogger().substep(`E2E binary: ${distBinary}`)
  getDefaultLogger().substep('Test command: pnpm --filter @socketsecurity/cli run e2e:smol')
  getDefaultLogger().logNewline()
  getDefaultLogger().success('Binary copied to dist/socket-smol for e2e testing')
  getDefaultLogger().logNewline()

  // Write source hash to cache file for future builds.
  const sourcePaths = collectBuildSourceFiles()
  const sourceHashComment = await generateHashComment(sourcePaths)
  const cacheDir = join(BUILD_DIR, '.cache')
  await mkdir(cacheDir, { recursive: true })
  const hashFilePath = join(cacheDir, 'node.hash')
  await writeFile(hashFilePath, sourceHashComment, 'utf-8')
  getDefaultLogger().substep(`Cache hash: ${hashFilePath}`)
  getDefaultLogger().logNewline()

  // Report build complete.
  const binarySize = await getFileSize(distributionOutputBinary)
  await createCheckpoint(BUILD_DIR, 'complete')
  await cleanCheckpoint(BUILD_DIR)

  // Calculate total build time.
  const totalDuration = Date.now() - totalStart
  const totalTime = formatDuration(totalDuration)

  printHeader('🎉 Build Complete!')

  // ASCII art success.
  getDefaultLogger().logNewline()
  getDefaultLogger().log('    ╔═══════════════════════════════════════╗')
  getDefaultLogger().log('    ║                                       ║')
  getDefaultLogger().log('    ║     ✨ Build Successful! ✨          ║')
  getDefaultLogger().log('    ║                                       ║')
  getDefaultLogger().log('    ╚═══════════════════════════════════════╝')
  getDefaultLogger().logNewline()

  getDefaultLogger().log('📊 Build Statistics:')
  getDefaultLogger().log(`   Build time: ${buildTime}`)
  getDefaultLogger().log(`   Total time: ${totalTime}`)
  getDefaultLogger().log(`   Binary size: ${binarySize}`)
  getDefaultLogger().log(`   CPU cores used: ${CPU_COUNT}`)
  getDefaultLogger().logNewline()

  getDefaultLogger().log('📁 Binary Locations:')
  getDefaultLogger().log(`   Source:       ${nodeBinary}`)
  getDefaultLogger().log(`   Release:      ${outputReleaseBinary}`)
  getDefaultLogger().log(`   Stripped:     ${outputStrippedBinary}`)
  if (compressedBinary) {
    getDefaultLogger().log(`   Compressed:   ${compressedBinary} (signed, with decompression tool)`)
  }
  getDefaultLogger().log(`   Final:        ${finalBinary}`)
  getDefaultLogger().log(`   Distribution: ${distributionOutputBinary}`)
  getDefaultLogger().log(`   pkg cache:    ${targetPath}`)
  getDefaultLogger().logNewline()

  getDefaultLogger().log('🚀 Next Steps:')
  if (compressedBinary) {
    getDefaultLogger().log('   1. Test compressed binary:')
    getDefaultLogger().log(`      cd ${join(BUILD_DIR, 'out', 'Compressed')}`)
    const decompressTool = IS_MACOS
      ? './socket_macho_decompress'
      : WIN32
        ? './socket_pe_decompress.exe'
        : './socket_elf_decompress'
    getDefaultLogger().log(`      ${decompressTool} ./node --version`)
    getDefaultLogger().logNewline()
    getDefaultLogger().log('   2. Build Socket CLI with compressed Node:')
    getDefaultLogger().log('      (Use compressed binary for pkg builds)')
    getDefaultLogger().logNewline()
  } else {
    getDefaultLogger().log('   1. Build Socket CLI:')
    getDefaultLogger().log('      pnpm run build')
    getDefaultLogger().logNewline()
    getDefaultLogger().log('   2. Create pkg executable:')
    getDefaultLogger().log('      pnpm exec pkg .')
    getDefaultLogger().logNewline()
    getDefaultLogger().log('   3. Test the executable:')
    getDefaultLogger().log('      ./pkg-binaries/socket-macos-arm64 --version')
    getDefaultLogger().logNewline()
  }

  getDefaultLogger().log('💡 Helpful Commands:')
  getDefaultLogger().log('   Verify build: node scripts/verify-node-build.mjs')
  if (!shouldCompress) {
    getDefaultLogger().log('   Enable compression: COMPRESS_BINARY=1 node scripts/build.mjs')
  }
  getDefaultLogger().logNewline()

  getDefaultLogger().log('📚 Documentation:')
  getDefaultLogger().log('   Build process: build/patches/README.md')
  getDefaultLogger().log('   Troubleshooting: See README for common issues')
  getDefaultLogger().logNewline()

  if (RUN_VERIFY) {
    printHeader('Running Verification')
    getDefaultLogger().log('Running comprehensive verification checks...')
    getDefaultLogger().logNewline()

    try {
      await exec(
        'node',
        ['scripts/verify-node-build.mjs', `--node-version=${NODE_VERSION}`],
        {
          cwd: ROOT_DIR,
        },
      )
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
    getDefaultLogger().info('Tip: Run verification checks:')
    getDefaultLogger().substep('node scripts/verify-node-build.mjs')
    getDefaultLogger().logNewline()
  }

  // Step 10: Run tests if requested.
  if (RUN_TESTS || RUN_FULL_TESTS) {
    printHeader('Running Tests with Custom Node')
    getDefaultLogger().log(`Testing Socket CLI with custom Node.js ${NODE_VERSION}...`)
    getDefaultLogger().logNewline()

    try {
      const testArgs = [
        'scripts/test-with-custom-node.mjs',
        `--node-version=${NODE_VERSION}`,
      ]
      if (RUN_FULL_TESTS) {
        testArgs.push('--full')
      }

      await exec('node', testArgs, { cwd: ROOT_DIR })

      getDefaultLogger().logNewline()
      getDefaultLogger().success('Tests passed with custom Node.js binary!')
      getDefaultLogger().logNewline()
    } catch (_e) {
      printError(
        'Tests Failed',
        'Tests failed when using the custom Node.js binary.',
        [
          'Review test output above for details',
          'The binary may have issues with Socket CLI',
          'Consider rebuilding: node scripts/build-custom-node.mjs --clean',
          'Or run tests manually: node scripts/test-with-custom-node.mjs',
        ],
      )
      throw new Error('Tests failed with custom Node.js')
    }
  } else if (!RUN_VERIFY) {
    getDefaultLogger().info('Tip: Test with custom Node:')
    getDefaultLogger().substep('node scripts/test-with-custom-node.mjs')
    getDefaultLogger().logNewline()
  }
}

// Run main function.
main().catch(e => {
  getDefaultLogger().fail(`Build failed: ${e.message}`)
  throw e
})
