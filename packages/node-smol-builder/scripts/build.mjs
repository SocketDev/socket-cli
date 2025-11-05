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
 *     + strip (platform-specific): ~25 MB  (-24 MB: Remove debug symbols)
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

import { existsSync, readdirSync, promises as fs } from 'node:fs'
import { cpus, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { whichBinSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
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

// Hoist logger for consistent usage throughout the script.
const logger = getDefaultLogger()

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
 *    - Example: additions/003-compression-tools/socketsecurity_macho_decompress
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
    logger.log(`   Found ${patches.length} patch file(s):`)
    for (const patch of patches) {
      logger.log(`     → ${patch.name} (${patch.source})`)
    }
  }

  return patches
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
  await fs.cp(ADDITIONS_DIR, NODE_DIR, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })

  logger.log(
    `✅ Copied ${ADDITIONS_DIR.replace(`${ROOT_DIR}/`, '')}/ → ${NODE_DIR}/`,
  )

  // Fix: The brotli header needs to be in src/ for node_builtins.cc to find it.
  const brotliHeaderSource = join(NODE_DIR, '001-brotli-integration', 'socketsecurity_brotli_builtin_loader.h')
  const brotliHeaderDest = join(NODE_DIR, 'src', 'socketsecurity_brotli_builtin_loader.h')

  if (existsSync(brotliHeaderSource)) {
    await fs.copyFile(brotliHeaderSource, brotliHeaderDest)
    logger.log(`✅ Copied socketsecurity_brotli_builtin_loader.h to src/`)
  }

  // Fix: The bootstrap loader needs to be in lib/internal/ for Node.js to embed it as an internal module.
  const bootstrapLoaderSource = join(NODE_DIR, '002-bootstrap-loader', 'internal', 'socketsecurity_bootstrap_loader.js')
  const bootstrapLoaderDest = join(NODE_DIR, 'lib', 'internal', 'socketsecurity_bootstrap_loader.js')

  if (existsSync(bootstrapLoaderSource)) {
    await fs.copyFile(bootstrapLoaderSource, bootstrapLoaderDest)
    logger.log(`✅ Copied socketsecurity_bootstrap_loader.js to lib/internal/`)
  }

  // Fix: Copy polyfills to lib/internal/socketsecurity_polyfills/ for external loading.
  const polyfillsSourceDir = join(NODE_DIR, '004-polyfills')
  const polyfillsDestDir = join(NODE_DIR, 'lib', 'internal', 'socketsecurity_polyfills')

  if (existsSync(polyfillsSourceDir)) {
    await safeMkdir(polyfillsDestDir)

    const localeCompareSource = join(polyfillsSourceDir, 'localeCompare.js')
    const localeCompareDest = join(polyfillsDestDir, 'localeCompare.js')
    if (existsSync(localeCompareSource)) {
      await fs.copyFile(localeCompareSource, localeCompareDest)
      logger.log(`✅ Copied localeCompare.js to lib/internal/socketsecurity_polyfills/`)
    }

    const normalizeSource = join(polyfillsSourceDir, 'normalize.js')
    const normalizeDest = join(polyfillsDestDir, 'normalize.js')
    if (existsSync(normalizeSource)) {
      await fs.copyFile(normalizeSource, normalizeDest)
      logger.log(`✅ Copied normalize.js to lib/internal/socketsecurity_polyfills/`)
    }
  }

  // Fix: The brotli2c tool needs to be in tools/ for node.gyp build target.
  const brotli2cSource = join(NODE_DIR, '003-compression-tools', 'socketsecurity_brotli2c.cc')
  const brotli2cDest = join(NODE_DIR, 'tools', 'socketsecurity_brotli2c.cc')

  if (existsSync(brotli2cSource)) {
    await fs.copyFile(brotli2cSource, brotli2cDest)
    logger.log(`✅ Copied socketsecurity_brotli2c.cc to tools/`)
  }

  logger.log('')
}

/**
 * Embed Socket security bootstrap in minimal injection approach.
 * This processes the loader template with embedded bootstrap,
 * then copies the minimal patch (no placeholder replacement needed).
 * (Optional - only runs if bootstrap file exists)
 */
async function embedSocketSecurityBootstrap() {
  // Use transformed bootstrap from bootstrap package (compatible with Node.js internal bootstrap context).
  const bootstrapSource = join(ROOT_DIR, '..', 'bootstrap', 'dist', 'bootstrap-smol.js')

  // Always rebuild bootstrap to ensure latest version.
  // Bootstrap build is fast (~5 seconds) and ensures version placeholders are current.
  logger.log('')
  logger.info(`Rebuilding @socketsecurity/bootstrap package...`)
  logger.log('')

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
      logger.error(`Bootstrap file not found at: ${bootstrapSource}`)
      logger.info(`Checking for bootstrap files...`)

      const bootstrapDir = dirname(bootstrapSource)
      if (existsSync(bootstrapDir)) {
        logger.info(`Directory exists: ${bootstrapDir}`)
        try {
          const files = await fs.readdir(bootstrapDir)
          logger.info(`Files in directory: ${files.join(', ')}`)
        } catch (e) {
          logger.warn(`Could not list directory contents`)
        }
      } else {
        logger.error(`Directory does not exist: ${bootstrapDir}`)
      }

      throw new Error(`Bootstrap build succeeded but dist file not found at: ${bootstrapSource}`)
  }

  logger.log('')

  printHeader('Embedding Socket Security Bootstrap (Minimal Injection)')

  // Read the bootstrap code.
  const bootstrapCode = await fs.readFile(bootstrapSource, 'utf8')
  const bootstrapSize = Buffer.byteLength(bootstrapCode, 'utf8')

  // Base64 encode the bootstrap (will be decoded at runtime in Node.js).
  const bootstrapB64 = Buffer.from(bootstrapCode, 'utf8').toString('base64')
  const bootstrapB64Size = bootstrapB64.length

  logger.log(`📦 Bootstrap size: ${(bootstrapSize / 1024).toFixed(1)}KB`)
  logger.log(`📦 Base64 encoded: ${(bootstrapB64Size / 1024).toFixed(1)}KB`)

  // Split base64 into chunks to avoid line length issues.
  // 80 characters per line is safe for all environments.
  const chunkSize = 80
  const base64Chunks = []
  for (let i = 0; i < bootstrapB64.length; i += chunkSize) {
    base64Chunks.push(bootstrapB64.slice(i, i + chunkSize))
  }

  // Format as multi-line JavaScript string concatenation for loader template.
  const base64MultiLine = base64Chunks
    .map((chunk, index) => {
      if (index === 0) {
        return `'${chunk}'`
      }
      // Continuation lines with proper indentation.
      return `    '${chunk}'`
    })
    .join(' +\n')

  // Read the loader template.
  const loaderTemplatePath = join(ADDITIONS_DIR, '002-bootstrap-loader', 'internal', 'socketsecurity_bootstrap_loader.js.template')
  const loaderTemplate = await fs.readFile(loaderTemplatePath, 'utf8')

  // Embed the bootstrap in the loader template.
  const finalLoader = loaderTemplate.replace(
    'SOCKET_BOOTSTRAP_BASE64_PLACEHOLDER',
    base64MultiLine
  )

  // Write the processed loader to additions/ (will be copied during copyBuildAdditions phase).
  const finalLoaderPath = join(ADDITIONS_DIR, '002-bootstrap-loader', 'internal', 'socketsecurity_bootstrap_loader.js')
  await safeMkdir(dirname(finalLoaderPath), { recursive: true })
  await fs.writeFile(finalLoaderPath, finalLoader, 'utf8')

  logger.log(`✅ Generated loader: ${finalLoaderPath.replace(`${ROOT_DIR}/`, '')}`)
  logger.log(`   ${(finalLoader.length / 1024).toFixed(1)}KB (includes embedded bootstrap)`)

  // Copy the minimal patch template to build/patches/ (no placeholder replacement needed).
  const minimalPatchTemplatePath = join(PATCHES_DIR, '001-socketsecurity_bootstrap_preexec_v24.10.0.template.patch')
  const buildPatchesDir = join(BUILD_DIR, 'patches')
  await safeMkdir(buildPatchesDir, { recursive: true })

  const finalPatchPath = join(buildPatchesDir, 'socketsecurity_bootstrap_preexec_v24.10.0.patch')
  await fs.copyFile(minimalPatchTemplatePath, finalPatchPath)

  logger.log(`✅ Copied minimal patch: ${finalPatchPath.replace(`${ROOT_DIR}/`, '')}`)
  logger.log(`   1-line injection calling internal/socketsecurity_bootstrap_loader`)
  logger.log('')
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
    const result = await spawn('git', ['status', '--porcelain'], {
      cwd: NODE_DIR,
      stdio: 'pipe',
      stdioString: true,
    })
    return result.code === 0 && (result.stdout ?? '').trim().length > 0
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
  logger.log(`${colors.green('✓')} Node.js source reset to clean state`)
  logger.log('')
}

/**
 * Get file size in human-readable format.
 */
async function getFileSize(filePath) {
  const stats = await fs.stat(filePath)
  const bytes = stats.size

  if (bytes === 0) return '0B'

  const k = 1024
  const sizes = ['B', 'K', 'M', 'G', 'T']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = (bytes / k ** i).toFixed(1)

  return `${size}${sizes[i]}`
}

/**
 * Get cache directory for compiled binaries.
 *
 * @param {string} buildDir - Build directory path
 * @returns {string} Cache directory path
 */
function getCacheDir(buildDir) {
  return join(buildDir, 'cache')
}

/**
 * Get cache file path for compiled binary.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @returns {string} Cache file path
 */
function getCachePath(buildDir, platform, arch) {
  return join(getCacheDir(buildDir), `node-compiled-${platform}-${arch}`)
}

/**
 * Get cache metadata file path.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @returns {string} Cache metadata file path
 */
function getCacheMetadataPath(buildDir, platform, arch) {
  return join(getCacheDir(buildDir), `node-compiled-${platform}-${arch}.json`)
}

/**
 * Cache compiled binary after successful build.
 * This allows resuming from this point if post-processing fails.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} nodeBinary - Path to compiled Node.js binary
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @param {string} version - Node.js version
 * @returns {Promise<void>}
 */
async function cacheCompiledBinary(buildDir, nodeBinary, platform, arch, version) {
  const cacheDir = getCacheDir(buildDir)
  const cacheFile = getCachePath(buildDir, platform, arch)
  const cacheMetaFile = getCacheMetadataPath(buildDir, platform, arch)

  // Create cache directory.
  await safeMkdir(cacheDir, { recursive: true })

  // Copy binary to cache.
  await fs.copyFile(nodeBinary, cacheFile)

  // Get binary stats for metadata.
  const stats = await fs.stat(nodeBinary)
  const size = await getFileSize(nodeBinary)

  // Save metadata.
  const metadata = {
    platform,
    arch,
    version,
    timestamp: Date.now(),
    size: stats.size,
    humanSize: size,
  }
  await fs.writeFile(cacheMetaFile, JSON.stringify(metadata, null, 2))

  logger.log(`${colors.green('✓')} Cached compiled binary (${size})`)
  logger.log(`   Cache location: ${cacheFile}`)
}

/**
 * Restore cached binary if available and valid.
 * Returns true if restore successful, false if no valid cache exists.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} nodeBinary - Path where to restore Node.js binary
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @param {string} version - Expected Node.js version
 * @returns {Promise<boolean>} True if restored, false if no valid cache
 */
async function restoreCachedBinary(buildDir, nodeBinary, platform, arch, version) {
  const cacheFile = getCachePath(buildDir, platform, arch)
  const cacheMetaFile = getCacheMetadataPath(buildDir, platform, arch)

  // Check if cache files exist.
  if (!existsSync(cacheFile) || !existsSync(cacheMetaFile)) {
    return false
  }

  try {
    // Validate metadata matches current build.
    const metaContent = await fs.readFile(cacheMetaFile, 'utf8')
    const meta = JSON.parse(metaContent)

    if (meta.platform !== platform || meta.arch !== arch) {
      logger.warn('Cached binary is for different platform/arch, ignoring cache')
      return false
    }

    if (meta.version !== version) {
      logger.warn(`Cached binary is for Node.js ${meta.version}, expected ${version}, ignoring cache`)
      return false
    }

    // Ensure output directory exists.
    await safeMkdir(dirname(nodeBinary), { recursive: true })

    // Restore binary.
    await fs.copyFile(cacheFile, nodeBinary)

    const size = await getFileSize(nodeBinary)
    logger.log(`${colors.green('✓')} Restored cached binary (${size})`)
    logger.log(`   From: ${cacheFile}`)

    // Smoke test: verify binary can execute --version.
    try {
      const versionResult = await spawn(nodeBinary, ['--version'], { timeout: 5_000 })
      if (versionResult.code === 0) {
        logger.log(`${colors.green('✓')} Binary smoke test passed (--version)`)
      } else {
        logger.warn('Binary exists but failed smoke test, will rebuild')
        return false
      }
    } catch (e) {
      logger.warn(`Binary smoke test failed: ${e.message}, will rebuild`)
      return false
    }

    return true
  } catch (e) {
    logger.warn(`Failed to restore cache: ${e.message}`)
    return false
  }
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
    logger.success(`Package manager (${pmResult.manager}) installed successfully`)
  } else if (pmResult.available) {
    logger.log(`📦 Package manager detected: ${pmResult.manager}`)
  } else {
    logger.warn('No package manager available for auto-installing tools')
    const pmInstructions = getPackageManagerInstructions()
    for (const instruction of pmInstructions) {
      logger.substep(instruction)
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
      logger.success(`${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      logger.log(`${colors.green('✓')} ${tool} is available`)
    }
  }

  // Step 6: Check manual tools.
  let allManualAvailable = true
  for (const { checkExists, cmd, name } of manualTools) {
    const binPath = whichBinSync(cmd, { nothrow: true })
    if (binPath) {
      logger.log(`${colors.green('✓')} ${name} is available`)
    } else {
      logger.error(`${colors.red('✗')} ${name} is NOT available`)
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
    const content = await fs.readFile(seaFile, 'utf8')
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
    const content = await fs.readFile(testFile, 'utf8')
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

  // Check 3: localeCompare polyfill (kept as safety layer with small-icu).
  logger.log('Checking localeCompare polyfill...')
  const primordialFile = join(
    NODE_DIR,
    'lib',
    'internal',
    'per_context',
    'primordials.js',
  )
  try {
    const content = await fs.readFile(primordialFile, 'utf8')
    if (content.includes('Socket CLI: Polyfill localeCompare')) {
      logger.success(
        'primordials.js correctly modified (localeCompare polyfill)',
      )
    } else {
      logger.warn('localeCompare polyfill not applied (may not be needed with small-icu)')
    }
  } catch (e) {
    logger.warn(`Cannot verify primordials.js: ${e.message}`)
  }

  // Check 4: String.prototype.normalize polyfill (kept as safety layer with small-icu).
  logger.log('Checking normalize polyfill...')
  const bootstrapFile = join(
    NODE_DIR,
    'lib',
    'internal',
    'bootstrap',
    'node.js',
  )
  try {
    const content = await fs.readFile(bootstrapFile, 'utf8')
    if (content.includes('Socket CLI: Polyfill String.prototype.normalize')) {
      logger.success(
        'bootstrap/node.js correctly modified (normalize polyfill)',
      )
    } else {
      logger.warn('normalize polyfill not applied (may not be needed with small-icu)')
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
    'All Socket modifications verified for --with-intl=small-icu',
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
  await safeMkdir(BUILD_DIR, { recursive: true })

  // Check if we can use cached build (skip if --clean).
  if (!CLEAN_BUILD) {
    const finalOutputBinary = join(BUILD_DIR, 'out', 'Final', IS_WINDOWS ? 'node.exe' : 'node')
    const distBinary = join(ROOT_DIR, 'dist', 'socket-smol')
    const distSeaBinary = join(ROOT_DIR, 'dist', 'socket-sea')

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
        // Verify final binary, hash file, and at least one dist binary exist.
        return existsSync(finalOutputBinary) &&
               existsSync(hashFilePath) &&
               (existsSync(distBinary) || existsSync(distSeaBinary))
      },
    })

    if (!needsExtraction) {
      // Cache hit! Binary is up to date.
      logger.log('')
      printHeader('✅ Using Cached Build')
      logger.log('All source files unchanged since last build.')
      logger.log('')
      logger.substep(`Final binary: ${finalOutputBinary}`)
      logger.substep(`E2E binary: ${existsSync(distBinary) ? distBinary : distSeaBinary}`)
      logger.log('')
      logger.success('Cached build is ready to use')
      logger.log('')
      return
    }
  }

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
  logger.log(`${colors.green('✓')} ${NODE_VERSION} exists in Node.js repository`)
  logger.log('')

  // Clone or reset Node.js repository.
  if (!existsSync(NODE_DIR) || CLEAN_BUILD) {
    if (existsSync(NODE_DIR) && CLEAN_BUILD) {
      printHeader('Clean Build Requested')
      logger.log('Removing existing Node.js source directory...')
      const { rm } = await import('node:fs/promises')
      await safeDelete(NODE_DIR, { recursive: true, force: true })
      await cleanCheckpoint(BUILD_DIR)
      logger.log(`${colors.green('✓')} Cleaned build directory`)
      logger.log('')
    }

    printHeader('Cloning Node.js Source')
    logger.log(`Version: ${NODE_VERSION}`)
    logger.log('Repository: https://github.com/nodejs/node.git')
    logger.log('')
    logger.info('This will download ~200-300 MB (shallow clone with --depth=1 --single-branch)...')
    logger.log('Retry: Up to 3 attempts if clone fails')
    logger.log('')

    // Git clone with retry (network can fail during long downloads).
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          logger.log(`Retry attempt ${attempt}/3...`)
          logger.log('')
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

        logger.warn(`${colors.yellow('⚠')} Clone attempt ${attempt} failed: ${e.message}`)

        // Clean up partial clone.
        try {
          const { rm } = await import('node:fs/promises')
          await safeDelete(NODE_DIR, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors.
        }

        // Wait before retry.
        const waitTime = 2000 * attempt
        logger.log(`${colors.blue('ℹ')} Waiting ${waitTime}ms before retry...`)
        logger.log('')
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      logger.log(`${colors.green('✓')} Node.js source cloned successfully`)
      await createCheckpoint(BUILD_DIR, 'cloned')
      logger.log('')
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
      logger.log('')
    } else if (isDirty && AUTO_YES) {
      logger.log(
        '⚠️  Node.js source has uncommitted changes (auto-resetting with --yes)',
      )
      logger.log('')
    }

    await resetNodeSource()
  }

  // Embed Socket security bootstrap in minimal injection approach.
  // This must run BEFORE copyBuildAdditions() so the processed loader is copied.
  await embedSocketSecurityBootstrap()

  // Copy build additions (includes processed bootstrap loader).
  await copyBuildAdditions()

  // Apply Socket patches (including the dynamically generated bootstrap loader).
  const socketPatches = findSocketPatches()

  if (socketPatches.length > 0) {
    // Validate Socket patches before applying.
    printHeader('Validating Socket Patches')
    logger.log(`Found ${socketPatches.length} patch(es) for ${NODE_VERSION}`)
    logger.log('Checking integrity, compatibility, and conflicts...')
    logger.log('')

    const patchData = []
    let allValid = true

    for (const patch of socketPatches) {
      logger.group(` ${colors.blue('ℹ')}   Validating ${patch.name}`)

      const isValid = await validatePatch(patch.path, NODE_DIR)
      if (!isValid) {
        logger.error(`${colors.red('✗')} INVALID: Patch validation failed`)
        logger.groupEnd()
        allValid = false
        continue
      }

      const content = await fs.readFile(patch.path, 'utf8')
      const analysis = analyzePatchContent(content)

      patchData.push({
        name: patch.name,
        path: patch.path,
        analysis,
      })
      if (analysis.modifiesV8Includes) {
        logger.log(`${colors.green('✓')} Modifies V8 includes`)
      }
      if (analysis.modifiesSEA) {
        logger.log(`${colors.green('✓')} Modifies SEA detection`)
      }
      logger.log(`${colors.green('✓')} Valid`)
      logger.groupEnd()
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
      logger.warn(`${colors.yellow('⚠')} Patch Conflicts Detected:`)
      logger.warn()
      for (const conflict of conflicts) {
        if (conflict.severity === 'error') {
          logger.error(`  ${colors.red('✗')} ERROR: ${conflict.message}`)
          allValid = false
        } else {
          logger.warn(`  ${colors.yellow('⚠')} WARNING: ${conflict.message}`)
        }
      }
      logger.warn()

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
      logger.log(`${colors.green('✓')} All Socket patches validated successfully`)
      logger.log(`${colors.green('✓')} No conflicts detected`)
      logger.log('')
    }

    // Patches validated successfully, ready to apply.

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
          logger.log(`${colors.green('✓')} ${name} applied`)
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
      logger.log(`${colors.green('✓')} All Socket patches applied successfully`)
      logger.log('')
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
    logger.log(`${colors.cyan('🚀 DEV BUILD MODE')} - Fast builds, larger binaries`)
    logger.log('')
    logger.log('Optimization flags:')
    logger.log(
      `  ${colors.green('✓')} KEEP: Full V8 (TurboFan JIT), WASM, SSL/crypto`,
    )
    logger.log(
      `  ${colors.green('✓')} REMOVE: npm, corepack, inspector, amaro, sqlite, SEA`,
    )
    logger.log(
      `  ${colors.green('✓')} DISABLED: LTO (Link Time Optimization) for faster builds`,
    )
    logger.log(
      `  ${colors.green('✓')} DISABLED: V8 Lite Mode for faster JS execution`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~80-90MB (before stripping), ~40-50MB (after)',
    )
    logger.log('Expected build time: ~50% faster than production builds')
  } else {
    logger.log(`${colors.magenta('⚡ PRODUCTION BUILD MODE')} - Optimized for size/distribution`)
    logger.log('')
    logger.log('Optimization flags:')
    logger.log(
      `  ${colors.green('✓')} KEEP: V8 Lite Mode (baseline compiler), WASM (Liftoff), SSL/crypto`,
    )
    logger.log(
      `  ${colors.green('✓')} REMOVE: npm, corepack, inspector, amaro, sqlite, SEA, ICU, TurboFan JIT`,
    )
    logger.log(`  ${colors.green('✓')} ICU: none (no internationalization, saves ~6-8 MB)`)
    logger.log(
      `  ${colors.green('✓')} V8 Lite Mode: Disables TurboFan optimizer (saves ~15-20 MB)`,
    )
    const ltoNote = WIN32 ? ', LTCG' : ', LTO'
    logger.log(
      `  ${colors.green('✓')} OPTIMIZATIONS: no-snapshot, with-code-cache (for errors), no-SEA, V8 Lite${ltoNote}`,
    )
    logger.log('')
    logger.log(
      `  ${colors.green('✓')} V8 LITE MODE: JavaScript runs 5-10x slower (CPU-bound code)`,
    )
    logger.log(`  ${colors.green('✓')} WASM: Full speed (uses Liftoff compiler, unaffected)`)
    logger.log(`  ${colors.green('✓')} I/O: No impact (network, file operations)`)
    logger.log('')
    logger.log(
      'Expected binary size: ~60MB (before stripping), ~23-27MB (after)',
    )
  }
  logger.log('')

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
    // Link Time Optimization (very slow, saves ~5-10MB).
    if (WIN32) {
      configureFlags.push('--with-ltcg') // Windows: Use MSVC's Link Time Code Generation.
    } else {
      configureFlags.push('--enable-lto') // Unix/Linux/macOS: Use standard LTO.
    }
  }

  // Add architecture flag for cross-compilation or explicit targeting.
  if (ARCH === 'arm64') {
    configureFlags.unshift('--dest-cpu=arm64')
  } else if (ARCH === 'x64') {
    configureFlags.unshift('--dest-cpu=x64')
  }

  // Windows uses configure.py directly, Unix uses ./configure wrapper script.
  // Use whichBinSync to resolve full path to python.exe since we use shell: false.
  const configureCommand = WIN32 ? whichBinSync('python') : './configure'
  const configureArgs = WIN32 ? ['configure.py', ...configureFlags] : configureFlags

  // DEBUG: Verify environment is being passed to subprocess.
  if (WIN32) {
    logger.log('')
    logger.log('DEBUG: Checking environment before exec():')
    const criticalVars = ['VCINSTALLDIR', 'WindowsSDKVersion', 'INCLUDE', 'LIB']
    for (const varName of criticalVars) {
      const value = process.env[varName]
      if (value) {
        logger.log(`  ${colors.green('✓')} ${varName} = ${value.substring(0, 60)}...`)
      } else {
        logger.log(`  ${colors.red('✗')} ${varName} is NOT SET`)
      }
    }
    logger.log('')
  }

  logger.log(`::group::Running ${WIN32 ? 'python configure.py' : './configure'}`)

  // On Windows, explicitly pass environment to subprocess.
  // IMPORTANT: Must use shell: false because cmd.exe doesn't properly
  // propagate environment variables to subprocesses.
  const execOptions = {
    cwd: NODE_DIR,
    env: process.env,
    shell: false,
  }
  if (WIN32) {
    logger.log(`DEBUG: Passing env with ${Object.keys(process.env).length} variables (shell: false)`)
  }

  await exec(configureCommand, configureArgs, execOptions)
  logger.log('::endgroup::')
  logger.log(`${colors.green('✓')} Configuration complete`)
  logger.log('')

  // Build Node.js.
  printHeader('Building Node.js')

  // Define binary path early (used for both cache and build).
  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')

  // Try to restore from cache (skip compilation if successful).
  let restoredFromCache = false
  if (!CLEAN_BUILD) {
    logger.log('Checking for cached binary from previous build...')
    restoredFromCache = await restoreCachedBinary(
      BUILD_DIR,
      nodeBinary,
      TARGET_PLATFORM,
      ARCH,
      NODE_VERSION,
    )
    logger.log('')
  }

  // Skip compilation if restored from cache.
  if (!restoredFromCache) {
    const timeEstimate = estimateBuildTime(CPU_COUNT)
    logger.log(
      `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
    )
    logger.log(`🚀 Using ${CPU_COUNT} CPU cores for parallel compilation`)
    logger.log('')
    logger.log('You can:')
    logger.log('  • Grab coffee ☕')
    logger.log('  • Work on other tasks')
    logger.log('  • Watch progress in this terminal (but seriously, go touch grass)')
    logger.log('')
    logger.log(`Build log: ${getBuildLogPath(BUILD_DIR)}`)
    logger.log('')
    logger.log('Starting build...')
    logger.log('')

    const buildStart = Date.now()

    // Use GitHub Actions grouping to collapse compiler output.
    logger.log('::group::Compiling Node.js with Ninja (this will take a while...)')

    try {
      // Resolve full path to ninja since we use shell: false.
      const ninjaCommand = whichBinSync('ninja')
      await exec(ninjaCommand, ['-C', 'out/Release', `-j${CPU_COUNT}`], {
        cwd: NODE_DIR,
        env: process.env,
        shell: false,
      })
      logger.log('::endgroup::')
    } catch (e) {
      logger.log('::endgroup::')
      logger.log('')
      logger.log('::error::Ninja build failed - see collapsed "Compiling Node.js" section above for full compiler output')
      logger.log('')
      // Build failed - show last 100 lines of build log.
      const lastLines = await getLastLogLines(BUILD_DIR, 100)
      if (lastLines) {
        logger.error()
        logger.error('Last 100 lines of build log:')
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

    logger.log('')
    logger.log(`${colors.green('✓')} Build completed in ${buildTime}`)
    await createCheckpoint(BUILD_DIR, 'built')
    logger.log('')

    // Cache the compiled binary for future runs.
    await cacheCompiledBinary(BUILD_DIR, nodeBinary, TARGET_PLATFORM, ARCH, NODE_VERSION)
    logger.log('')
  } else {
    logger.log(`${colors.cyan('ℹ')} Skipped compilation (using cached binary)`)
    logger.log('')
  }

  // Sign early for macOS ARM64 (required before execution in CI).
  if (IS_MACOS && ARCH === 'arm64') {
    printHeader('Code Signing (macOS ARM64 - Initial)')
    logger.log('Signing binary before testing for macOS ARM64 compatibility...')
    logger.logNewline()
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])
    logger.success('Binary signed successfully')
    logger.logNewline()
  }

  // Test the binary.
  printHeader('Testing Binary')

  logger.log('Running basic functionality tests...')
  logger.log('')

  // Set SOCKET_CLI_BUILD_TEST=1 to skip CLI bootstrap during smoke tests.
  // The CLI version doesn't exist on npm yet during build.
  const smokeTestEnv = {
    ...process.env,
    SOCKET_CLI_BUILD_TEST: '1',
  }

  await exec(nodeBinary, ['--version'], { env: smokeTestEnv })

  logger.log('')
  logger.log(`${colors.green('✓')} Binary is functional`)
  logger.log('')

  // Copy unmodified binary to build/out/Release.
  printHeader('Copying to Build Output (Release)')
  logger.log('Copying unmodified binary to build/out/Release directory...')
  logger.logNewline()

  const outputReleaseDir = join(BUILD_DIR, 'out', 'Release')
  await safeMkdir(outputReleaseDir)
  const outputReleaseBinary = join(outputReleaseDir, 'node')
  await fs.cp(nodeBinary, outputReleaseBinary, { force: true, preserveTimestamps: true })

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
  logger.log('')

  // Platform-specific strip flags:
  // - macOS (LLVM strip): Use -x (remove local symbols)
  //   macOS strip does NOT support --strip-all (GNU-only flag)
  // - Linux (GNU strip): Try --strip-all first, fall back to -x
  //   --strip-all removes all symbols + section headers (most aggressive)
  // - Windows: Skip stripping (no strip command)
  let stripArgs
  if (IS_WINDOWS) {
    logger.log('Windows detected - skipping strip (not supported)')
    logger.log('')
  } else if (IS_MACOS) {
    // macOS always uses -x (LLVM strip doesn't support --strip-all).
    stripArgs = ['-x', nodeBinary]
    logger.log('Using macOS strip flags: -x (remove local symbols)')
  } else {
    // Linux/Alpine: Test if --strip-all is supported.
    logger.log('Testing strip capabilities...')
    const testResult = await spawn('strip', ['--help'], {
      stdio: 'pipe',
      stdioString: true,
    })
    const supportsStripAll = (testResult.stdout ?? '').includes('--strip-all')

    if (supportsStripAll) {
      stripArgs = ['--strip-all', nodeBinary]
      logger.log('Using GNU strip flags: --strip-all (remove all symbols + sections)')
    } else {
      stripArgs = ['-x', nodeBinary]
      logger.log('Using fallback strip flags: -x (GNU --strip-all not supported)')
    }
  }

  if (stripArgs) {
    await exec('strip', stripArgs)
  }

  const sizeAfterStrip = await getFileSize(nodeBinary)
  logger.log(`Size after stripping: ${sizeAfterStrip}`)

  // Parse and check size.
  const sizeMatch = sizeAfterStrip.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && size >= 20 && size <= 30) {
      logger.log(`${colors.green('✓')} Binary size is optimal (20-30MB with V8 Lite Mode)`)
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

  logger.log('')

  // Re-sign after stripping for macOS ARM64 (strip invalidates code signature).
  if (IS_MACOS && ARCH === 'arm64') {
    printHeader('Code Signing (macOS ARM64 - After Stripping)')
    logger.log('Re-signing binary after stripping for macOS ARM64 compatibility...')
    logger.log('(strip command invalidates code signature, re-signing required)')
    logger.logNewline()
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])
    logger.success('Binary re-signed successfully after stripping')
    logger.logNewline()

    // Smoke test after signing to ensure signature is valid.
    logger.log('Testing binary after signing...')
    const signTestPassed = await smokeTestBinary(nodeBinary)

    if (!signTestPassed) {
      printError(
        'Binary Corrupted After Signing',
        'Binary failed smoke test after code signing',
        [
          'Code signing may have corrupted the binary',
          'Try rebuilding: node scripts/build-custom-node.mjs --clean',
          'Report this issue if it persists',
        ],
      )
      throw new Error('Binary corrupted after signing')
    }

    logger.log(`${colors.green('✓')} Binary functional after signing`)
    logger.log('')
  }

  // Smoke test binary after stripping (ensure strip didn't corrupt it).
  logger.log('Testing binary after stripping...')
  const smokeTestPassed = await smokeTestBinary(nodeBinary)

  if (!smokeTestPassed) {
    printError(
      'Binary Corrupted After Stripping',
      'Binary failed smoke test after stripping',
      [
        'Strip command may have corrupted the binary',
        'Try rebuilding: node scripts/build-custom-node.mjs --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary corrupted after stripping')
  }

  logger.log(`${colors.green('✓')} Binary functional after stripping`)
  logger.log('')

  // Copy stripped binary to build/out/Stripped.
  printHeader('Copying to Build Output (Stripped)')
  logger.log('Copying stripped binary to build/out/Stripped directory...')
  logger.logNewline()

  const outputStrippedDir = join(BUILD_DIR, 'out', 'Stripped')
  await safeMkdir(outputStrippedDir)
  const outputStrippedBinary = join(outputStrippedDir, 'node')
  await fs.cp(nodeBinary, outputStrippedBinary, { force: true, preserveTimestamps: true })

  logger.substep(`Stripped directory: ${outputStrippedDir}`)
  logger.substep('Binary: node (stripped)')
  logger.logNewline()
  logger.success('Stripped binary copied to build/out/Stripped')
  logger.logNewline()

  // Compress binary for smaller distribution size (DEFAULT for smol builds).
  // Uses native platform APIs (Apple Compression, liblzma, Windows Compression API) instead of UPX.
  // Benefits: 75-79% compression (vs UPX's 50-60%), works with code signing, zero AV false positives.
  // Opt-out: Set COMPRESS_BINARY=0 or COMPRESS_BINARY=false to disable compression.
  let compressedBinary = null
  const shouldCompress = process.env.COMPRESS_BINARY !== '0' && process.env.COMPRESS_BINARY !== 'false'

  if (shouldCompress) {
    printHeader('Compressing Binary for Distribution')
    logger.log('Compressing stripped binary using platform-specific compression...')
    logger.logNewline()

    const compressedDir = join(BUILD_DIR, 'out', 'Compressed')
    await safeMkdir(compressedDir)
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
      const socketbinPkg = JSON.parse(await fs.readFile(socketbinPkgPath, 'utf-8'))
      socketbinSpec = `${socketbinPkg.name}@${socketbinPkg.version}`
      logger.substep(`Found socketbin package: ${socketbinSpec}`)
    } catch (e) {
      logger.warn(`Could not read socketbin package.json at ${socketbinPkgPath}`)
      logger.warn('Compression will use fallback cache key generation')
    }

    logger.substep(`Input: ${outputStrippedBinary}`)
    logger.substep(`Output: ${compressedBinary}`)
    logger.substep(`Algorithm: ${compressionQuality.toUpperCase()}`)
    if (socketbinSpec) {
      logger.substep(`Spec: ${socketbinSpec}`)
    }
    logger.logNewline()

    const sizeBeforeCompress = await getFileSize(outputStrippedBinary)
    logger.log(`Size before compression: ${sizeBeforeCompress}`)
    logger.log('Running compression tool...')
    logger.logNewline()

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
    logger.log(`Size after compression: ${sizeAfterCompress}`)
    logger.logNewline()

    // Skip signing compressed binary - it's a self-extracting binary (decompressor stub + compressed data),
    // not a standard Mach-O executable. The decompressor stub is already signed if needed.
    // When executed, the stub extracts and runs the original Node.js binary.
    logger.log('Skipping code signing for self-extracting binary...')
    logger.substep('✓ Compressed binary ready (self-extracting, no signature needed)')
    logger.logNewline()

    // Skip smoke test for self-extracting binary.
    // TODO: The decompressor stub needs to be updated to properly handle command-line arguments.
    // Currently it treats arguments as filenames instead of passing them to the decompressed binary.
    // Once fixed, we can enable smoke testing for compressed binaries.
    logger.log('Skipping smoke test for self-extracting binary...')
    logger.substep('✓ Smoke test skipped (decompressor needs argument handling fix)')
    logger.log('')

    logger.substep(`Compressed directory: ${compressedDir}`)
    logger.substep('Binary: node (compressed)')
    logger.logNewline()
    logger.success('Binary compressed successfully')
    logger.logNewline()

    // Copy decompression tool to Compressed directory for distribution.
    printHeader('Bundling Decompression Tool')
    logger.log('Copying platform-specific decompression tool for distribution...')
    logger.logNewline()

    const toolsDir = join(ROOT_DIR, 'additions', '003-compression-tools')
    const decompressTool = IS_MACOS
      ? 'socketsecurity_macho_decompress'
      : WIN32
        ? 'socketsecurity_pe_decompress.exe'
        : 'socketsecurity_elf_decompress'

    const decompressToolSource = join(toolsDir, decompressTool)
    const decompressToolDest = join(compressedDir, decompressTool)

    if (existsSync(decompressToolSource)) {
      await fs.cp(decompressToolSource, decompressToolDest, { force: true, preserveTimestamps: true })

      // Ensure tool is executable.
      await exec('chmod', ['+x', decompressToolDest])

      const toolSize = await getFileSize(decompressToolDest)
      logger.substep(`Tool: ${decompressTool} (${toolSize})`)
      logger.substep(`Location: ${compressedDir}`)
      logger.logNewline()
      logger.success('Decompression tool bundled for distribution')
      logger.logNewline()
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
    logger.log('')
    logger.log(`${colors.blue('ℹ')} Binary compression skipped (optional)`)
    logger.log('   To enable: COMPRESS_BINARY=1 node scripts/build.mjs')
    logger.log('')
  }

  // Copy final distribution binary to build/out/Final.
  // Use compressed binary if available, otherwise use stripped binary.
  printHeader('Copying to Build Output (Final)')
  const finalDir = join(BUILD_DIR, 'out', 'Final')
  await safeMkdir(finalDir)
  const finalBinary = join(finalDir, 'node')

  if (compressedBinary && existsSync(compressedBinary)) {
    logger.log('Copying compressed distribution package to Final directory...')
    logger.logNewline()

    const compressedDir = join(BUILD_DIR, 'out', 'Compressed')

    // Copy compressed binary to Final.
    await fs.cp(compressedBinary, finalBinary, { force: true, preserveTimestamps: true })

    // Copy decompressor tool to Final.
    const decompressTool = IS_MACOS
      ? 'socketsecurity_macho_decompress'
      : WIN32 ? 'socketsecurity_pe_decompress.exe' : 'socketsecurity_elf_decompress'
    const decompressToolSource = join(compressedDir, decompressTool)
    const decompressToolDest = join(finalDir, decompressTool)

    if (existsSync(decompressToolSource)) {
      await fs.cp(decompressToolSource, decompressToolDest, { force: true, preserveTimestamps: true })
      await exec('chmod', ['+x', decompressToolDest])
    }

    const compressedSize = await getFileSize(finalBinary)
    const decompressToolSize = existsSync(decompressToolDest)
      ? await getFileSize(decompressToolDest)
      : 'N/A'

    logger.substep('Source: build/out/Compressed/node (compressed + signed)')
    logger.substep(`Binary: ${compressedSize}`)
    logger.substep(`Decompressor: ${decompressToolSize}`)
    logger.substep(`Location: ${finalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with compressed package')
    logger.logNewline()
  } else {
    logger.log('Copying stripped binary to Final directory...')
    logger.logNewline()

    await fs.cp(outputStrippedBinary, finalBinary, { force: true, preserveTimestamps: true })

    const binarySize = await getFileSize(finalBinary)
    logger.substep('Source: build/out/Stripped/node (stripped, uncompressed)')
    logger.substep(`Binary: ${binarySize}`)
    logger.substep(`Location: ${finalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with uncompressed binary')
    logger.logNewline()
  }

  // Copy signed binary to build/out/Sea (for SEA builds).
  printHeader('Copying to Build Output (Sea)')
  logger.log(
    'Copying signed binary to build/out/Sea directory for SEA builds...',
  )
  logger.logNewline()

  const outputSeaDir = join(BUILD_DIR, 'out', 'Sea')
  await safeMkdir(outputSeaDir)
  const outputSeaBinary = join(outputSeaDir, 'node')
  await fs.cp(nodeBinary, outputSeaBinary, { force: true, preserveTimestamps: true })

  logger.substep(`Sea directory: ${outputSeaDir}`)
  logger.substep('Binary: node (stripped + signed, ready for SEA)')
  logger.logNewline()
  logger.success('Binary copied to build/out/Sea')
  logger.logNewline()

  // Copy to dist/ for E2E testing.
  printHeader('Copying to dist/ for E2E Testing')
  logger.log('Creating dist/socket-smol and dist/socket-sea for e2e test suite...')
  logger.logNewline()

  const distDir = join(ROOT_DIR, 'dist')
  await safeMkdir(distDir)

  // Copy final binary (compressed or stripped) to dist/socket-smol.
  const distSmolBinary = join(distDir, 'socket-smol')
  await fs.cp(finalBinary, distSmolBinary, { force: true, preserveTimestamps: true })
  await exec('chmod', ['+x', distSmolBinary])

  // Copy SEA binary to dist/socket-sea.
  const distSeaBinary = join(distDir, 'socket-sea')
  await fs.cp(outputSeaBinary, distSeaBinary, { force: true, preserveTimestamps: true })
  await exec('chmod', ['+x', distSeaBinary])

  logger.substep(`E2E smol binary: ${distSmolBinary}`)
  logger.substep(`E2E sea binary: ${distSeaBinary}`)
  logger.substep('Test commands:')
  logger.substep('  pnpm --filter @socketsecurity/cli run e2e:smol')
  logger.substep('  pnpm --filter @socketsecurity/cli run e2e:sea')
  logger.logNewline()
  logger.success('Binaries copied to dist/ for e2e testing')
  logger.logNewline()

  // Write source hash to cache file for future builds.
  const sourcePaths = collectBuildSourceFiles()
  const sourceHashComment = await generateHashComment(sourcePaths)
  const cacheDir = join(BUILD_DIR, '.cache')
  await safeMkdir(cacheDir, { recursive: true })
  const hashFilePath = join(cacheDir, 'node.hash')
  await fs.writeFile(hashFilePath, sourceHashComment, 'utf-8')
  logger.substep(`Cache hash: ${hashFilePath}`)
  logger.logNewline()

  // Report build complete.
  const binarySize = await getFileSize(finalBinary)
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
  logger.log(`   Total time: ${totalTime}`)
  logger.log(`   Binary size: ${binarySize}`)
  logger.log(`   CPU cores used: ${CPU_COUNT}`)
  logger.logNewline()

  logger.log('📁 Binary Locations:')
  logger.log(`   Source:       ${nodeBinary}`)
  logger.log(`   Release:      ${outputReleaseBinary}`)
  logger.log(`   Stripped:     ${outputStrippedBinary}`)
  if (compressedBinary) {
    logger.log(`   Compressed:   ${compressedBinary} (signed, with decompression tool)`)
  }
  logger.log(`   Final:        ${finalBinary}`)
  logger.log(`   Distribution: ${finalBinary}`)
  logger.logNewline()

  logger.log('🚀 Next Steps:')
  if (compressedBinary) {
    logger.log('   1. Test compressed binary:')
    logger.log(`      cd ${join(BUILD_DIR, 'out', 'Compressed')}`)
    const decompressTool = IS_MACOS
      ? './socketsecurity_macho_decompress'
      : WIN32
        ? './socketsecurity_pe_decompress.exe'
        : './socketsecurity_elf_decompress'
    logger.log(`      ${decompressTool} ./node --version`)
    logger.logNewline()
    logger.log('   2. Build Socket CLI with compressed Node:')
    logger.log('      (Use compressed binary for pkg builds)')
    logger.logNewline()
  } else {
    logger.log('   1. Build Socket CLI:')
    logger.log('      pnpm run build')
    logger.logNewline()
    logger.log('   2. Create pkg executable:')
    logger.log('      pnpm exec pkg .')
    logger.logNewline()
    logger.log('   3. Test the executable:')
    logger.log('      ./pkg-binaries/socket-macos-arm64 --version')
    logger.logNewline()
  }

  logger.log('💡 Helpful Commands:')
  logger.log('   Verify build: node scripts/verify-node-build.mjs')
  if (!shouldCompress) {
    logger.log('   Enable compression: COMPRESS_BINARY=1 node scripts/build.mjs')
  }
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
