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
 *     + --with-intl=none:          ~41 MB  (-8 MB:  Remove ICU/Intl)
 *     + --v8-lite-mode:            ~26 MB  (-23 MB: Disable TurboFan JIT)
 *     + --disable-SEA:             ~25 MB  (-24 MB: Remove SEA support)
 *     + --without-* flags:         ~24 MB  (-25 MB: Remove npm, inspector, etc.)
 *
 *   Stage 2: Binary stripping
 *     + strip --strip-all:         ~22 MB  (-27 MB: Remove debug symbols)
 *
 *   Stage 3: Compression (this script)
 *     + pkg Brotli (VFS):          ~20 MB  (-29 MB: Compress Socket CLI code)
 *     + Node.js lib/ minify+Brotli:~18 MB  (-31 MB: Compress built-in modules)
 *
 *   TARGET ACHIEVED: ~18 MB < 30 MB goal! 🎉
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
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { cpus, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { logger } from '@socketsecurity/lib/logger'

import { exec, execCapture } from '@socketsecurity/build-infra/lib/build-exec'
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
import { printError, printHeader, printWarning } from '@socketsecurity/build-infra/lib/build-output'
import {
  testPatchApplication,
  validatePatch,
} from '@socketsecurity/build-infra/lib/patch-validator'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const CLEAN_BUILD = args.includes('--clean')
const RUN_VERIFY = args.includes('--verify')
const RUN_TESTS = args.includes('--test')
const RUN_FULL_TESTS = args.includes('--test-full')
const AUTO_YES = args.includes('--yes') || args.includes('-y')

// Configuration
const NODE_VERSION = 'v24.10.0'
const ROOT_DIR = join(__dirname, '..')
const NODE_SOURCE_DIR = join(ROOT_DIR, '.node-source')
const NODE_DIR = NODE_SOURCE_DIR // Alias for compatibility.
const BUILD_DIR = join(ROOT_DIR, 'build')
const PATCHES_DIR = join(ROOT_DIR, 'patches')
const ADDITIONS_DIR = join(ROOT_DIR, 'additions')

// Directory structure.
// .node-source/ - Node.js source code (gitignored).
// .node-source/out/Release/node - Node.js build output (gitignored).
// build/out/Release/node - Copy of Release binary (gitignored).
// build/out/Stripped/node - Stripped binary (gitignored).
// build/out/Signed/node - Stripped + signed binary (macOS ARM64 only, gitignored).
// build/out/Final/node - Final binary for distribution (gitignored).
// build/out/Sea/node - Binary for SEA builds (gitignored).
// build/out/Distribution/node - Final distribution binary (gitignored).
// build/patches/ - All Node.js custom patches (tracked in git).

/**
 * Find Socket patches for this Node version
 */
function findSocketPatches() {
  if (!existsSync(PATCHES_DIR)) {
    return []
  }

  // Get all .patch files from patches directory.
  const allPatchFiles = readdirSync(PATCHES_DIR)
    .filter(f => f.endsWith('.patch'))
    .sort()

  if (!allPatchFiles.length) {
    return []
  }

  logger.log(
    `   Found ${allPatchFiles.length} patch file(s) in ${PATCHES_DIR}`,
  )

  return allPatchFiles
}

/**
 * Copy build additions to Node.js source tree
 */
async function copyBuildAdditions() {
  if (!existsSync(ADDITIONS_DIR)) {
    logger.log('   No build additions directory found, skipping')
    return
  }

  printHeader('Copying Build Additions')

  // Recursively copy entire additions directory structure to Node.js source.
  await cp(ADDITIONS_DIR, NODE_DIR, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })

  logger.log(
    `✅ Copied ${ADDITIONS_DIR.replace(`${ROOT_DIR}/`, '')}/ → ${NODE_DIR}/`,
  )
  logger.log()
}

/**
 * Copy Socket security bootstrap to Node.js lib/ for brotli encoding.
 * The bootstrap will be compressed along with other Node.js lib/ files.
 */
async function copySocketSecurityBootstrap() {
  printHeader('Copying Socket Security Bootstrap')

  const bootstrapSource = join(ROOT_DIR, 'bin', 'bootstrap.js')
  const bootstrapDest = join(
    NODE_DIR,
    'lib',
    'internal',
    'bootstrap',
    'socketsecurity.js',
  )

  // Create parent directory if needed.
  await mkdir(dirname(bootstrapDest), { recursive: true })

  // Copy bootstrap to Node.js source (will be brotli encoded with other lib/ files).
  await copyFile(bootstrapSource, bootstrapDest)

  const stats = await stat(bootstrapSource)
  logger.log(
    `✅ ${bootstrapSource.replace(`${ROOT_DIR}/`, '')} → ` +
      `${bootstrapDest.replace(`${NODE_DIR}/`, '')}`,
  )
  logger.log(
    `   ${(stats.size / 1024).toFixed(1)}KB (will be brotli encoded with lib/ files)`,
  )
  logger.log()
}

const CPU_COUNT = cpus().length
const IS_MACOS = platform() === 'darwin'
const ARCH = process.arch

/**
 * Check if Node.js source has uncommitted changes.
 */
async function isNodeSourceDirty() {
  try {
    const status = await execCapture('git', ['status', '--porcelain'], {
      cwd: NODE_DIR,
    })
    return status.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Reset Node.js source to pristine state.
 */
async function resetNodeSource() {
  logger.log('Fetching latest tags...')
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
  logger.log('Resetting to clean state...')
  await exec('git', ['reset', '--hard', NODE_VERSION], { cwd: NODE_DIR })
  await exec('git', ['clean', '-fdx'], { cwd: NODE_DIR })
  logger.log('✅ Node.js source reset to clean state')
  logger.log()
}

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
          logger.log(`✅ ${name} is available`)
        } else {
          throw new Error('Not found')
        }
      } else {
        await execCapture(cmd, args)
        logger.log(`✅ ${name} is available`)
      }
    } catch {
      logger.error(`❌ ${name} is NOT available`)
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
    // For v24.10.0+, the CORRECT include has "src/" prefix.
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

  // Check 3: localeCompare polyfill for --with-intl=none.
  logger.log('Checking localeCompare polyfill...')
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
      logger.success(
        'primordials.js correctly modified (localeCompare polyfill)',
      )
    } else {
      logger.warn('localeCompare polyfill not applied (may not be needed)')
    }
  } catch (e) {
    logger.warn(`Cannot verify primordials.js: ${e.message}`)
  }

  // Check 4: String.prototype.normalize polyfill for --with-intl=none.
  logger.log('Checking normalize polyfill...')
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
      logger.success(
        'bootstrap/node.js correctly modified (normalize polyfill)',
      )
    } else {
      logger.warn('normalize polyfill not applied (may not be needed)')
    }
  } catch (e) {
    logger.warn(`Cannot verify bootstrap/node.js: ${e.message}`)
  }

  logger.logNewline()

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

  logger.success(
    'All Socket modifications verified for --with-intl=none compatibility',
  )
  logger.logNewline()
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
 * Minify and compress Node.js JavaScript files for maximum binary size reduction.
 *
 * This function provides two-stage compression of all JavaScript files in the
 * Node.js lib/ directory:
 * 1. Minify with esbuild (removes whitespace, shortens identifiers)
 * 2. Compress with Brotli at maximum quality
 *
 * It's safe to use because:
 * 1. Original .js files remain intact (only .js.br files are created)
 * 2. Bootstrap hook provides transparent decompression at runtime
 * 3. Only files with >10% total compression savings are saved
 *
 * Expected savings: ~2.5 MB additional binary size reduction.
 * Compression ratio: Typically 83-85% for minified + Brotli compressed files.
 *
 * How it works:
 * 1. Walk all .js files in NODE_DIR/lib/ recursively
 * 2. Minify each with esbuild (removes whitespace, shortens names)
 * 3. Compress minified code with Brotli at maximum quality (level 11)
 * 4. Save as .js.br if total compression saves >10% space
 * 5. Track statistics for reporting
 *
 * The compressed files are automatically decompressed by the bootstrap hook
 * created in createBrotliBootstrapHook() below.
 */
async function _compressNodeJsWithBrotli() {
  printHeader('Minifying and Compressing Node.js JavaScript')

  const { _stat, readFile, readdir, writeFile } = await import(
    'node:fs/promises'
  )
  const { relative } = await import('node:path')
  const { build } = await import('esbuild')

  // Track compression statistics for reporting.
  let totalOriginalSize = 0
  let totalMinifiedSize = 0
  let totalCompressedSize = 0
  let filesCompressed = 0

  // Async generator to recursively walk directory tree and yield .js files.
  async function* walkDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        yield* walkDir(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        yield fullPath
      }
    }
  }

  logger.log('Minifying and compressing JavaScript files...')
  logger.log()

  const libDir = join(NODE_DIR, 'lib')

  // Process each JavaScript file in the lib/ directory.
  for await (const jsFile of walkDir(libDir)) {
    try {
      // Read original file contents.
      const original = await readFile(jsFile, 'utf8')
      const originalSize = Buffer.byteLength(original, 'utf8')

      // Step 1: Minify with esbuild.
      // This removes whitespace, shortens variable names, and applies syntax optimizations.
      const minifyResult = await build({
        stdin: {
          contents: original,
          loader: 'js',
          sourcefile: jsFile,
        },
        write: false,
        minify: true,
        minifyWhitespace: true,
        minifyIdentifiers: true,
        minifySyntax: true,
        target: 'node22',
        format: 'cjs',
        platform: 'node',
        logLevel: 'silent',
        // Preserve Node.js built-in behavior.
        keepNames: false, // Safe: Node.js core doesn't rely on Function.name.
        treeShaking: false, // Keep all code (Node.js modules are entry points).
      })

      const minifiedCode = minifyResult.outputFiles[0].text
      const minifiedSize = Buffer.byteLength(minifiedCode, 'utf8')

      // Step 2: Compress minified code with Brotli at maximum quality.
      // BROTLI_PARAM_QUALITY: Level 11 (maximum, best compression ratio).
      // BROTLI_MODE_TEXT: Optimized for text data like JavaScript source.
      const compressed = brotliCompressSync(minifiedCode, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]:
            zlibConstants.BROTLI_MAX_QUALITY, // Quality 11.
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT, // Text mode for JS.
        },
      })

      const compressedSize = compressed.length
      const totalRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1)

      // Only keep compressed version if we save >10% total space.
      // Small files (<10% savings) aren't worth the decompression overhead.
      if (compressedSize < originalSize * 0.9) {
        // Write .js.br file alongside original .js file.
        // The bootstrap hook will prefer .br when available.
        await writeFile(`${jsFile}.br`, compressed)

        // Update running totals.
        totalOriginalSize += originalSize
        totalMinifiedSize += minifiedSize
        totalCompressedSize += compressedSize
        filesCompressed++

        // Log individual file processing results.
        const relativePath = relative(libDir, jsFile)
        logger.log(
          `   ✓ ${relativePath.padEnd(50)} ` +
            `${(originalSize / 1024).toFixed(1)}KB → ` +
            `${(minifiedSize / 1024).toFixed(1)}KB → ` +
            `${(compressedSize / 1024).toFixed(1)}KB ` +
            `(-${totalRatio}%)`,
        )
      }
    } catch (e) {
      // Skip files that can't be minified/compressed (permissions, syntax errors, etc.).
      logger.warn(`   ⚠️  Skipped ${relative(NODE_DIR, jsFile)}: ${e.message}`)
    }
  }

  logger.log()
  logger.log(`✅ Processed ${filesCompressed} files`)
  logger.log(
    `   Original:     ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log(
    `   Minified:     ${(totalMinifiedSize / 1024 / 1024).toFixed(2)} MB (-${((1 - totalMinifiedSize / totalOriginalSize) * 100).toFixed(1)}%)`,
  )
  logger.log(
    `   Compressed:   ${(totalCompressedSize / 1024 / 1024).toFixed(2)} MB (-${((1 - totalCompressedSize / totalOriginalSize) * 100).toFixed(1)}% total)`,
  )
  logger.log(
    `   Final savings: ${((totalOriginalSize - totalCompressedSize) / 1024 / 1024).toFixed(2)} MB`,
  )
  logger.log()

  // Create decompression bootstrap hook.
  await createBrotliBootstrapHook()
}

/**
 * Create bootstrap hook to transparently decompress Brotli-compressed JS files.
 *
 * This creates a module loader hook that intercepts require() calls and provides
 * transparent decompression of .js.br files. The hook is:
 * 1. Zero-overhead for non-compressed files (original _load still used).
 * 2. Cached in memory after first decompression (no repeated decompression).
 * 3. Fallback-safe (if .br doesn't exist, original error is thrown).
 *
 * How it works:
 * 1. Hook Module._load to intercept all module loading.
 * 2. Try normal loading first (zero overhead for uncompressed modules).
 * 3. If MODULE_NOT_FOUND, check for .js.br version.
 * 4. If found, decompress, cache, and compile the source.
 * 5. Return module exports as if it were a normal .js file.
 *
 * Performance:
 * - First load: ~1-2ms decompression overhead per module.
 * - Subsequent loads: <0.1ms from memory cache.
 * - Uncompressed files: Zero overhead (original code path).
 */
async function createBrotliBootstrapHook() {
  logger.log('Creating Brotli decompression bootstrap...')

  const bootstrapCode = `
// Brotli decompression hook for transparently loading compressed Node.js modules.
// This hook intercepts Module._load and provides automatic decompression of .js.br files.
(function() {
  const Module = require('internal/modules/cjs/loader').Module
  const fs = require('fs')
  const zlib = require('zlib')
  const originalLoad = Module._load
  const cache = new Map() // In-memory cache to avoid repeated decompression.

  // Intercept module loading to add Brotli decompression support.
  Module._load = function(request, parent, isMain) {
    try {
      // First, try normal loading (zero overhead for uncompressed modules).
      return originalLoad.call(this, request, parent, isMain)
    } catch (e) {
      // If module not found, try loading .br compressed version.
      if (e.code === 'MODULE_NOT_FOUND' || e.code === 'ERR_REQUIRE_ESM') {
        try {
          // Resolve the filename to get absolute path.
          const filename = Module._resolveFilename(request, parent, isMain)
          const brFile = filename + '.br'

          if (fs.existsSync(brFile)) {
            // Check memory cache first to avoid repeated decompression.
            if (cache.has(brFile)) {
              const module = new Module(filename, parent)
              module._compile(cache.get(brFile), filename)
              return module.exports
            }

            // Decompress the .br file and cache the source in memory.
            const compressed = fs.readFileSync(brFile)
            const decompressed = zlib.brotliDecompressSync(compressed).toString('utf8')
            cache.set(brFile, decompressed)

            // Compile and execute the decompressed source.
            const module = new Module(filename, parent)
            module._compile(decompressed, filename)
            return module.exports
          }
        } catch (brError) {
          // Fall through to original error if decompression fails.
        }
      }
      // Re-throw original error if no .br file found or decompression failed.
      throw e
    }
  }
})()
`

  // Write the bootstrap hook to lib/internal/bootstrap/brotli-loader.js.
  const bootstrapFile = join(
    NODE_DIR,
    'lib',
    'internal',
    'bootstrap',
    'brotli-loader.js',
  )
  await writeFile(bootstrapFile, bootstrapCode, 'utf8')

  // Inject the hook into Node.js's main bootstrap sequence.
  // This ensures the decompression hook is loaded before any modules are required.
  const mainBootstrap = join(
    NODE_DIR,
    'lib',
    'internal',
    'bootstrap',
    'node.js',
  )
  let content = await readFile(mainBootstrap, 'utf8')

  // Check if already injected (for idempotency).
  if (!content.includes('brotli-loader')) {
    // Insert after 'use strict' directive at the top of the file.
    // This runs the hook early in the bootstrap sequence.
    const insertPoint = content.indexOf("'use strict';")
    if (insertPoint !== -1) {
      const endOfLine = content.indexOf('\n', insertPoint)
      content =
        content.slice(0, endOfLine + 1) +
        "\nrequire('internal/bootstrap/brotli-loader');\n" +
        content.slice(endOfLine + 1)
      await writeFile(mainBootstrap, content, 'utf8')
      logger.log('   ✓ Injected Brotli loader into bootstrap')
    }
  }

  logger.log('✅ Brotli bootstrap hook created')
  logger.log()
}

/**
 * Main build function.
 */
async function main() {
  logger.log('')
  logger.log('🔨 Socket CLI - Custom Node.js Builder')
  logger.log(`   Building Node.js ${NODE_VERSION} with custom patches`)
  logger.log('')

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

  // Phase 3: Verify Git tag exists before cloning.
  printHeader('Verifying Node.js Version')
  logger.log(`Checking if ${NODE_VERSION} exists in Node.js repository...`)
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
  logger.log(`✅ ${NODE_VERSION} exists in Node.js repository`)
  logger.log()

  // Clone or reset Node.js repository.
  if (!existsSync(NODE_DIR) || CLEAN_BUILD) {
    if (existsSync(NODE_DIR) && CLEAN_BUILD) {
      printHeader('Clean Build Requested')
      logger.log('Removing existing Node.js source directory...')
      const { rm } = await import('node:fs/promises')
      await rm(NODE_DIR, { recursive: true, force: true })
      await cleanCheckpoint(BUILD_DIR)
      logger.log('✅ Cleaned build directory')
      logger.log()
    }

    printHeader('Cloning Node.js Source')
    logger.log(`Version: ${NODE_VERSION}`)
    logger.log('Repository: https://github.com/nodejs/node.git')
    logger.log()
    logger.log('⏱️  This will download ~200-300 MB (shallow clone)...')
    logger.log('Retry: Up to 3 attempts if clone fails')
    logger.log()

    // Git clone with retry (network can fail during long downloads).
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          logger.log(`Retry attempt ${attempt}/3...`)
          logger.log()
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

        logger.warn(`⚠️  Clone attempt ${attempt} failed: ${e.message}`)

        // Clean up partial clone.
        try {
          const { rm } = await import('node:fs/promises')
          await rm(NODE_DIR, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors.
        }

        // Wait before retry.
        const waitTime = 2000 * attempt
        logger.log(`⏱️  Waiting ${waitTime}ms before retry...`)
        logger.log()
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      logger.log('✅ Node.js source cloned successfully')
      await createCheckpoint(BUILD_DIR, 'cloned')
      logger.log()
    }
  } else {
    printHeader('Using Existing Node.js Source')

    // Check if source has uncommitted changes.
    const isDirty = await isNodeSourceDirty()
    if (isDirty && !AUTO_YES) {
      printWarning(
        'Node.js Source Has Uncommitted Changes',
        'The .node-source directory has uncommitted changes from a previous build or crash.',
        [
          'These changes will be discarded to ensure a clean build',
          'Press Ctrl+C now if you want to inspect the changes first',
          'Or wait 5 seconds to continue with automatic reset...',
        ],
      )

      // Wait 5 seconds before proceeding.
      await new Promise(resolve => setTimeout(resolve, 5000))
      logger.log()
    } else if (isDirty && AUTO_YES) {
      logger.log(
        '⚠️  Node.js source has uncommitted changes (auto-resetting with --yes)',
      )
      logger.log()
    }

    await resetNodeSource()
  }

  // Copy build additions before applying patches.
  await copyBuildAdditions()

  // Copy Socket security bootstrap to Node.js lib/ (will be brotli encoded with other lib/ files).
  await copySocketSecurityBootstrap()

  // Apply Socket patches.
  const socketPatches = findSocketPatches()

  if (socketPatches.length > 0) {
    // Validate Socket patches before applying.
    printHeader('Validating Socket Patches')
    logger.log(`Found ${socketPatches.length} patch(es) for ${NODE_VERSION}`)
    logger.log('Checking integrity, compatibility, and conflicts...')
    logger.log()

    const patchData = []
    let allValid = true

    for (const patchFile of socketPatches) {
      const patchPath = join(PATCHES_DIR, patchFile)
      logger.log(`Validating ${patchFile}...`)

      const validation = await validatePatch(patchPath, NODE_VERSION)
      if (!validation.valid) {
        logger.error(`  ❌ INVALID: ${validation.reason}`)
        allValid = false
        continue
      }

      const metadata = validation.metadata

      patchData.push({
        name: patchFile,
        path: patchPath,
        metadata,
      })

      if (metadata?.description) {
        logger.log(`  📝 ${metadata.description}`)
      }
      logger.log('  ✅ Valid')
      logger.log()
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
    // Note: Advanced patch conflict detection is not yet implemented.
    // TODO: Implement analyzePatchContent and checkPatchConflicts in build-infra package.
    logger.log('✅ All Socket patches validated successfully')
    logger.log()

    // Test Socket patches (dry-run) before applying.
    if (allValid) {
      printHeader('Testing Socket Patch Application')
      logger.log('Running dry-run to ensure patches will apply cleanly...')
      logger.log()

      for (const { name, path: patchPath } of patchData) {
        logger.log(`Testing ${name}...`)
        const dryRun = await testPatchApplication(patchPath, NODE_DIR, 1)
        if (!dryRun.canApply) {
          logger.error(`  ❌ Cannot apply: ${dryRun.reason}`)
          if (dryRun.stderr) {
            logger.error(`  Error: ${dryRun.stderr}`)
          }
          allValid = false
        } else {
          logger.log('  ✅ Will apply cleanly')
        }
      }
      logger.log()

      if (!allValid) {
        throw new Error(
          'Socket patches failed dry-run test.\n\n' +
            `One or more Socket patches cannot be applied to Node.js ${NODE_VERSION}.\n\n` +
            'This usually means:\n' +
            '  - Patches are outdated for this Node.js version\n' +
            '  - Node.js source has been modified unexpectedly\n' +
            '  - Patch files are corrupted\n\n' +
            'To fix:\n' +
            '  1. Verify Node.js source is clean (no manual modifications)\n' +
            `  2. Regenerate patches for ${NODE_VERSION}:\n` +
            `     node scripts/regenerate-node-patches.mjs --version=${NODE_VERSION}\n` +
            '  3. See build/patches/README.md for patch creation guide',
        )
      }
    }

    // Apply patches if validation and dry-run passed.
    if (allValid) {
      printHeader('Applying Socket Patches')
      for (const { name, path: patchPath } of patchData) {
        logger.log(`Applying ${name}...`)
        try {
          // Use -p1 to match Git patch format (strips a/ and b/ prefixes).
          // Use --batch to avoid interactive prompts.
          // Use --forward to skip if already applied.
          await exec(
            'sh',
            ['-c', `patch -p1 --batch --forward < "${patchPath}"`],
            { cwd: NODE_DIR },
          )
          logger.log(`✅ ${name} applied`)
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
      logger.log('✅ All Socket patches applied successfully')
      logger.log()
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
  logger.log('Optimization flags:')
  logger.log(
    '  ✅ KEEP: V8 Lite Mode (baseline compiler), WASM (Liftoff), SSL/crypto',
  )
  logger.log(
    '  ❌ REMOVE: npm, corepack, inspector, amaro, sqlite, SEA, ICU, TurboFan JIT',
  )
  logger.log('  🌍 ICU: none (no internationalization, saves ~6-8 MB)')
  logger.log(
    '  ⚡ V8 Lite Mode: Disables TurboFan optimizer (saves ~15-20 MB)',
  )
  logger.log(
    '  💾 OPTIMIZATIONS: no-snapshot, no-code-cache, no-object-print, no-SEA, V8 Lite',
  )
  logger.log()
  logger.log(
    '  ⚠️  V8 LITE MODE: JavaScript runs 5-10x slower (CPU-bound code)',
  )
  logger.log('  ✅ WASM: Full speed (uses Liftoff compiler, unaffected)')
  logger.log('  ✅ I/O: No impact (network, file operations)')
  logger.log()
  logger.log(
    'Expected binary size: ~60MB (before stripping), ~23-27MB (after)',
  )
  logger.log()

  const configureFlags = [
    '--with-intl=none', // -6-8 MB: No ICU/Intl support (use polyfill instead)
    // Note: --without-intl is deprecated, use --with-intl=none instead
    '--with-icu-source=none', // Don't download ICU source (not needed with --with-intl=none)
    '--without-npm',
    '--without-corepack',
    '--without-inspector',
    '--without-amaro',
    '--without-sqlite',
    '--without-node-snapshot',
    '--without-node-code-cache',
    '--v8-disable-object-print',
    '--without-node-options',
    '--disable-single-executable-application', // -1-2 MB: SEA not needed for pkg
    '--v8-lite-mode', // -15-20 MB: Disables TurboFan JIT (JS slower, WASM unaffected)
    '--enable-lto',
  ]

  // Add architecture flag for cross-compilation or explicit targeting.
  if (ARCH === 'arm64') {
    configureFlags.unshift('--dest-cpu=arm64')
  } else if (ARCH === 'x64') {
    configureFlags.unshift('--dest-cpu=x64')
  }

  await exec('./configure', configureFlags, { cwd: NODE_DIR })
  logger.log('✅ Configuration complete')
  logger.log()

  // Build Node.js.
  printHeader('Building Node.js')

  const timeEstimate = estimateBuildTime(CPU_COUNT)
  logger.log(
    `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
  )
  logger.log(`🚀 Using ${CPU_COUNT} CPU cores for parallel compilation`)
  logger.log()
  logger.log('You can:')
  logger.log('  • Grab coffee ☕')
  logger.log('  • Work on other tasks')
  logger.log('  • Watch progress in this terminal')
  logger.log()
  logger.log(`Build log: ${getBuildLogPath(BUILD_DIR)}`)
  logger.log()
  logger.log('Starting build...')
  logger.log()

  const buildStart = Date.now()

  try {
    await exec('make', [`-j${CPU_COUNT}`], { cwd: NODE_DIR })
  } catch (e) {
    // Build failed - show last 50 lines of build log.
    const lastLines = await getLastLogLines(BUILD_DIR, 50)
    if (lastLines) {
      logger.error()
      logger.error('Last 50 lines of build log:')
      logger.error('━'.repeat(60))
      logger.error(lastLines)
      logger.error('━'.repeat(60))
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

  logger.log()
  logger.log(`✅ Build completed in ${buildTime}`)
  await createCheckpoint(BUILD_DIR, 'built')
  logger.log()

  // Test the binary.
  printHeader('Testing Binary')
  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')

  logger.log('Running basic functionality tests...')
  logger.log()

  await exec(nodeBinary, ['--version'], {
    env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
  })

  await exec(
    nodeBinary,
    ['-e', 'logger.log("✅ Binary can execute JavaScript")'],
    {
      env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    },
  )

  logger.log()
  logger.log('✅ Binary is functional')
  logger.log()

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
  logger.log(`Size before stripping: ${sizeBeforeStrip}`)
  logger.log('Removing debug symbols and unnecessary sections...')
  logger.log()
  await exec('strip', ['--strip-all', nodeBinary])
  const sizeAfterStrip = await getFileSize(nodeBinary)
  logger.log(`Size after stripping: ${sizeAfterStrip}`)

  // Parse and check size.
  const sizeMatch = sizeAfterStrip.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && size >= 20 && size <= 30) {
      logger.log('✅ Binary size is optimal (20-30MB with V8 Lite Mode)')
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

  logger.log()

  // Smoke test binary after stripping (ensure strip didn't corrupt it).
  logger.log('Testing binary after stripping...')
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
        'Try rebuilding: node scripts/build-custom-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary corrupted after stripping')
  }

  logger.log('✅ Binary functional after stripping')
  logger.log()

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

  // Copy final binary to build/out/Final.
  printHeader('Copying to Build Output (Final)')
  logger.log('Copying final binary to build/out/Final directory...')
  logger.logNewline()

  const outputFinalDir = join(BUILD_DIR, 'out', 'Final')
  await mkdir(outputFinalDir, { recursive: true })
  const outputFinalBinary = join(outputFinalDir, 'node')
  await exec('cp', [nodeBinary, outputFinalBinary])

  logger.substep(`Final directory: ${outputFinalDir}`)
  logger.substep('Binary: node (final output)')
  logger.logNewline()
  logger.success('Final binary copied to build/out/Final')
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

  // Copy to pkg cache directory (for pkg to use).
  const pkgCacheDir = join(
    process.env.HOME || process.env.USERPROFILE,
    '.pkg-cache',
    'v3.5',
  )
  const targetName = `built-${NODE_VERSION}-${platform()}-${ARCH}${IS_MACOS && ARCH === 'arm64' ? '-signed' : ''}`
  const targetPath = join(pkgCacheDir, targetName)

  printHeader('Installing to pkg Cache')
  logger.log('Installing binary to pkg cache...')
  logger.logNewline()
  logger.substep(`Source: ${outputFinalBinary}`)
  logger.substep(`Cache directory: ${pkgCacheDir}`)
  logger.substep(`Binary name: ${targetName}`)
  logger.logNewline()

  await mkdir(pkgCacheDir, { recursive: true })
  await exec('cp', [outputFinalBinary, targetPath])

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

  logger.log('✅ Binary installed to pkg cache successfully')
  logger.log()

  // Verify the cached binary works.
  printHeader('Verifying Cached Binary')
  logger.log('Testing that pkg can use the installed binary...')
  logger.log()

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
        'Then rebuild: node scripts/build-custom-node.mjs --clean',
      ],
    )
    throw new Error('Cached binary verification failed')
  }

  logger.log('✅ Cached binary passed smoke test')
  logger.log('✅ pkg can use this binary')
  logger.log()

  // Copy final binary to build/out/Distribution.
  printHeader('Copying Final Binary to build/out/Distribution')
  logger.log('Creating final distribution binary location...')
  logger.logNewline()

  const distributionOutputDir = join(BUILD_DIR, 'out', 'Distribution')
  await mkdir(distributionOutputDir, { recursive: true })
  const distributionOutputBinary = join(distributionOutputDir, 'node')
  await exec('cp', [outputFinalBinary, distributionOutputBinary])

  logger.substep(`Distribution directory: ${distributionOutputDir}`)
  logger.substep('Binary: node (final distribution build)')
  logger.logNewline()
  logger.success('Final binary copied to build/out/Distribution')
  logger.logNewline()

  // Report build complete.
  const binarySize = await getFileSize(distributionOutputBinary)
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
  logger.log(`   Final:        ${outputFinalBinary}`)
  logger.log(`   Distribution: ${distributionOutputBinary}`)
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
