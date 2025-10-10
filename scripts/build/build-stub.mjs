
/**
 * @fileoverview Build stub/SEA (Single Executable Application) binaries
 *
 * This script orchestrates the creation of standalone executables using
 * yao-pkg with custom Node.js builds.
 */

import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile, copyFile, stat, unlink, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { platform as osPlatform, arch as osArch, homedir } from 'node:os'

import colors from 'yoctocolors-cjs'

import { default as ensureCustomNodeInCache } from './ensure-node-in-cache.mjs'
import { fetchYaoPatches } from './fetch-yao-patches.mjs'
import { loadBuildConfig } from './load-config.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const STUB_DIR = join(ROOT_DIR, 'build', 'output')
const DIST_DIR = join(ROOT_DIR, 'dist')
const BUILD_ARTIFACTS_DIR = join(ROOT_DIR, '.build')
const PKG_CONFIG = join(BUILD_ARTIFACTS_DIR, 'pkg.json')
const PKG_CACHE_BASE = join(homedir(), '.pkg-cache')

/**
 * Generate pkg.json from build-config.json5
 */
async function generatePkgConfig() {
  // Read the unified build config
  const buildConfig = loadBuildConfig()

  // Extract the yao (@yao-pkg/pkg) configuration directly from the central config
  // This is the single source of truth for all pkg settings
  const pkgConfig = {
    name: buildConfig.yao.name,
    bin: buildConfig.yao.binaries,
    pkg: {
      // Include all pkg settings from the central config
      bytecode: buildConfig.yao.bytecode,
      compress: buildConfig.yao.compress,
      dictionary: buildConfig.yao.dictionary,
      assets: buildConfig.yao.assets
    }
  }

  // Ensure build artifacts directory exists
  await mkdir(BUILD_ARTIFACTS_DIR, { recursive: true })

  // Write pkg.json to build artifacts directory
  await writeFile(PKG_CONFIG, JSON.stringify(pkgConfig, null, 2))

  console.log(`   Generated pkg config: ${PKG_CONFIG.replace(ROOT_DIR, '.')}`)
  console.log(`   Bytecode disabled: ${pkgConfig.pkg.bytecode === false}`)

  return PKG_CONFIG
}

/**
 * Get the current pkg-fetch version from installed packages
 */
function getPkgFetchVersion() {
  // First, try to get pkg-fetch version from lock file (most reliable)
  try {
    const lockFile = readFileSync(join(ROOT_DIR, 'pnpm-lock.yaml'), 'utf8')
    // Look for @yao-pkg/pkg-fetch@X.Y.Z pattern
    const pkgFetchMatch = lockFile.match(/@yao-pkg\/pkg-fetch@(\d+\.\d+)\.\d+/)
    if (pkgFetchMatch) {
      return `v${pkgFetchMatch[1]}`
    }
  } catch {}

  // Second, check node_modules for actual installed version
  try {
    const pkgFetchPath = join(ROOT_DIR, 'node_modules/@yao-pkg/pkg-fetch/package.json')
    if (existsSync(pkgFetchPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgFetchPath, 'utf8'))
      const version = pkgJson.version
      if (version) {
        const match = version.match(/^(\d+\.\d+)/)
        if (match) {
          return `v${match[1]}`
        }
      }
    }
  } catch {}

  // Third: scan existing cache directories to find what's actually being used
  if (existsSync(PKG_CACHE_BASE)) {
    const dirs = readdirSync(PKG_CACHE_BASE)
    const versionDirs = dirs.filter(d => d.match(/^v\d+\.\d+$/))
    if (versionDirs.length > 0) {
      // Return the newest version directory
      return versionDirs.sort().reverse()[0]
    }
  }

  // Default fallback to known version
  return 'v3.5'
}

/**
 * Find all possible cache directories for pkg binaries
 */
function getPkgCacheDirs() {
  const dirs = []

  if (!existsSync(PKG_CACHE_BASE)) {
    return dirs
  }

  // Get current version directory
  const currentVersion = getPkgFetchVersion()
  const currentDir = join(PKG_CACHE_BASE, currentVersion)
  if (existsSync(currentDir)) {
    dirs.push(currentDir)
  }

  // Also check all other version directories
  try {
    const allDirs = readdirSync(PKG_CACHE_BASE)
    for (const dir of allDirs) {
      if (dir.match(/^v\d+\.\d+$/) && dir !== currentVersion) {
        const versionDir = join(PKG_CACHE_BASE, dir)
        if (existsSync(versionDir)) {
          dirs.push(versionDir)
        }
      }
    }

    // Legacy 'node' directory
    const nodeDir = join(PKG_CACHE_BASE, 'node')
    if (existsSync(nodeDir)) {
      dirs.push(nodeDir)
    }
  } catch {}

  return dirs
}

/**
 * Check if a v24 binary exists in any pkg cache for the target
 */
function checkV24BinaryInCache(target, preferStripped = false) {
  const [nodeVersion, platform, arch] = target.split('-')
  const baseNames = [
    `built-v24.9.0-${platform}-${arch}`,
    `built-v24.8.0-${platform}-${arch}`,
    `built-v24-${platform}-${arch}`,
    `fetched-v24.9.0-${platform}-${arch}`,
    `fetched-v24.8.0-${platform}-${arch}`,
    `fetched-v24-${platform}-${arch}`
  ]

  const cacheDirs = getPkgCacheDirs()

  for (const dir of cacheDirs) {
    for (const baseName of baseNames) {
      // If preferStripped, check for stripped version first
      if (preferStripped) {
        const strippedPath = join(dir, `${baseName}-stripped`)
        if (existsSync(strippedPath)) {
          console.log(`   Found stripped binary in ${dir.replace(homedir(), '~')}`)
          return strippedPath
        }
      }

      // Check for regular version
      const cachePath = join(dir, baseName)
      if (existsSync(cachePath)) {
        console.log(`   Found cached binary in ${dir.replace(homedir(), '~')}`)
        return cachePath
      }
    }
  }

  return null
}

/**
 * Create a stripped version of a Node binary if it doesn't exist
 */
async function ensureStrippedBinary(sourcePath) {
  const strippedPath = `${sourcePath}-stripped`

  // If stripped version already exists and is newer, use it
  if (existsSync(strippedPath)) {
    const sourceStats = await stat(sourcePath)
    const strippedStats = await stat(strippedPath)
    if (strippedStats.mtime >= sourceStats.mtime) {
      return strippedPath
    }
  }

  // Create stripped version
  console.log('   Creating stripped version of Node binary...')
  await copyFile(sourcePath, strippedPath)

  // Remove any existing signature
  try {
    execSync(`codesign --remove-signature "${strippedPath}"`, { stdio: 'ignore' })
  } catch {}

  // Strip symbols
  const beforeSize = (await stat(strippedPath)).size
  try {
    execSync(`strip "${strippedPath}"`)
    const afterSize = (await stat(strippedPath)).size
    const savedMB = ((beforeSize - afterSize) / 1024 / 1024).toFixed(1)
    console.log(`   ${colors.green('✓')} Stripped ${savedMB}MB from base binary`)
    return strippedPath
  } catch (e) {
    // If stripping fails, remove the bad copy and use original
    try {
      await unlink(strippedPath)
    } catch {}
    return sourcePath
  }
}

/**
 * Build Node v24 from source with yao-pkg patches
 * This is needed when pre-built binaries fail with placeholder errors
 */
async function buildV24FromSource(pkgConfig, target, outputPath, quiet) {
  console.log('🔨 Building Node v24 from source with yao-pkg patches...')
  console.log('   This will take 30-45 minutes on first run')
  console.log('   Subsequent builds will use cached binary\n')

  // Check if we already have a built v24 in cache
  const cachedBinary = checkV24BinaryInCache(target)
  if (cachedBinary) {
    console.log(`${colors.green('✓')} Found cached v24 binary`)
    console.log(`   Using: ${cachedBinary.replace(homedir(), '~')}`)
    await copyFile(cachedBinary, outputPath)
    return 0
  }

  // Build from source
  const buildArgs = [
    'exec', 'pkg',
    '--build',  // This triggers source compilation
    pkgConfig,
    '--targets', target
  ]

  // Only add --no-bytecode if not already disabled in config
  const config = JSON.parse(readFileSync(pkgConfig, 'utf8'))
  if (config.pkg?.bytecode !== false) {
    buildArgs.push('--no-bytecode')
  }

  const env = {
    ...process.env,
    // Ensure no GitHub token interference
    NODE_PRE_GYP_GITHUB_TOKEN: ''
  }

  const currentVersion = getPkgFetchVersion()
  console.log(`📊 Starting build process...`)
  console.log(`   pkg-fetch version: ${currentVersion}`)
  console.log(`   Cache will be in: ~/.pkg-cache/${currentVersion}/`)

  const startTime = Date.now()

  const buildExitCode = await new Promise((resolve) => {
    const child = spawn('pnpm', buildArgs, {
      cwd: ROOT_DIR,
      env,
      stdio: quiet ? 'pipe' : 'inherit'
    })

    child.on('exit', (code) => resolve(code || 0))
    child.on('error', () => resolve(1))
  })

  if (buildExitCode !== 0) {
    console.error(`${colors.red('✗')} v24 source build failed`)
    return buildExitCode
  }

  const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`${colors.green('✓')} v24 build completed in ${elapsedMinutes} minutes`)

  // Copy from cache to target - pkg --build creates the binary with the exact target name
  const [nodeVer, platform, arch] = target.split('-')
  const expectedCacheDir = join(PKG_CACHE_BASE, currentVersion)
  const expectedBinaryName = `built-v24.9.0-${platform}-${arch}`
  const expectedPath = join(expectedCacheDir, expectedBinaryName)

  // Also check for the exact target name (pkg might use that)
  const altBinaryName = target
  const altPath = join(expectedCacheDir, altBinaryName)

  let builtBinary = null
  if (existsSync(expectedPath)) {
    builtBinary = expectedPath
  } else if (existsSync(altPath)) {
    builtBinary = altPath
  } else {
    // Fallback to full search
    builtBinary = checkV24BinaryInCache(target)
  }

  if (builtBinary) {
    console.log(`   Copying to: ${outputPath}`)
    await copyFile(builtBinary, outputPath)
    return 0
  }

  console.error(`${colors.red('✗')} Could not find built binary in cache`)
  console.error(`   Expected in: ${expectedCacheDir}`)
  return 1
}

/**
 * Build stub/SEA binary
 *
 * Build flow:
 * 1. Sync yao-pkg patches from GitHub (cached for 24 hours)
 * 2. Build distribution JavaScript if needed (dist/cli.js)
 * 3. Ensure custom Node.js binary exists in pkg cache
 * 4. Use yao-pkg to create self-contained executable
 *
 * Output: build/output/socket-{platform}-{arch}[.exe]
 */
export async function buildStub(options = {}) {
  const {
    arch = process.arch,
    builder = 'yao',  // 'yao' for yao-pkg or 'sea' for Node.js built-in SEA
    minify = false,
    nodeVersion = 'v24.9.0',
    platform = process.platform,
    quiet = false,
    syncYaoPatches = false
  } = options

  const buildTypeLabel = builder === 'yao' ? 'yao-pkg' : 'Node.js built-in SEA'
  console.log(`Building Single Executable (${buildTypeLabel})`)
  console.log('============================\n')

  // Step 0: Generate pkg.json config from build-config.json
  await generatePkgConfig()

  // Step 1: Sync yao-pkg patches if needed (force sync with --sync-yao-patches)
  if (syncYaoPatches) {
    if (!quiet) console.log('🔄 Syncing yao-pkg patches from upstream...')
    await fetchYaoPatches({ quiet })
  }

  // Step 1: Ensure distribution files exist
  if (!existsSync(DIST_DIR) || !existsSync(join(DIST_DIR, 'cli.js'))) {
    console.log('📦 Building distribution files first...')

    const buildExitCode = await new Promise((resolve) => {
      const child = spawn('pnpm', ['run', 'build', '--src'], {
        cwd: ROOT_DIR,
        stdio: quiet ? 'pipe' : 'inherit'
      })
      child.on('exit', (code) => resolve(code || 0))
      child.on('error', () => resolve(1))
    })

    if (buildExitCode !== 0) {
      console.error(`${colors.red('✗')} Failed to build distribution files`)
      return 1
    }
    console.log(`${colors.green('✓')} Distribution files built\n`)
  }

  // Step 2: Ensure custom Node binary exists in cache
  const customNodeScript = join(__dirname, 'build-tiny-node.mjs')

  console.log('Ensuring custom Node.js binary...')

  try {
    const cachePath = await ensureCustomNodeInCache(nodeVersion, platform, arch)
    console.log(`${colors.green('✓')} Custom Node ready: ${cachePath}\n`)
  } catch (error) {
    console.error(`${colors.red('✗')} Failed to prepare custom Node: ${error.message}`)

    console.log('\nTo build custom Node.js:')
    console.log(`   node ${customNodeScript} --version=${nodeVersion}`)
    return 1
  }

  // Step 3: Check and install required tools
  console.log('Checking build requirements...')

  // Check for essential tools on all platforms
  const essentialTools = await checkEssentialTools(platform, arch, quiet)
  if (!essentialTools) {
    console.error(`${colors.red('✗')} Failed to install essential build tools`)
    return 1
  }

  // Additional checks for macOS
  if (platform === 'darwin') {
    // Check for ldid on ARM64 (required for proper signing)
    if (arch === 'arm64') {
      const ldidCheck = await checkAndInstallLdid(quiet)
      if (ldidCheck === 'not-found') {
        console.error(`${colors.red('✗')} Could not install ldid - binary will be malformed`)
        console.error('   The stub binary will not work properly on ARM64')
        console.error('   Try installing manually: brew install ldid')
        // Exit early - no point building a broken binary
        return 1
      } else if (ldidCheck === 'newly-installed') {
        console.log(`${colors.green('✓')} ldid installed successfully`)
      } else {
        console.log(`${colors.green('✓')} ldid is available`)
      }
    }
  }

  console.log(`${colors.green('✓')} All build requirements met\n`)

  // Step 4: Create output directory
  await mkdir(STUB_DIR, { recursive: true })

  // Step 5: Build with pkg
  const target = getPkgTarget(platform, arch, nodeVersion)
  const outputName = getOutputName(platform, arch)
  const finalOutputPath = join(STUB_DIR, outputName)

  // Use temp directory for building to preserve pristine binaries
  const tempDir = join(tmpdir(), `socket-build-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  const tempOutputPath = join(tempDir, outputName)

  const isV24 = target.startsWith('node24')

  // For v24, check if we have a cached Node binary to use for packaging
  let v24CachedNode = null
  if (isV24) {
    // First look for a stripped version, then fall back to regular
    v24CachedNode = checkV24BinaryInCache(target, true)
    if (v24CachedNode) {
      // If we found a regular binary, create a stripped version if on macOS
      if (!v24CachedNode.endsWith('-stripped') && platform === 'darwin') {
        v24CachedNode = await ensureStrippedBinary(v24CachedNode)
      }
      console.log(`📦 Found cached v24 Node binary to use for packaging`)
      console.log(`   Using: ${v24CachedNode.replace(homedir(), '~')}`)
    } else {
      console.log('📦 No cached v24 binary found, will build if needed')
    }
  }

  // Always run pkg to package the application
  {
    console.log('📦 Building with yao-pkg...')
    console.log(`   Target: ${target}`)
    console.log(`   Temp output: ${tempOutputPath.replace(homedir(), '~')}`)
    console.log()

    // Build pkg command args
    const pkgArgs = [
      'exec', 'pkg',
      PKG_CONFIG,  // Use our generated config as the input
      '--targets', target,
      '--output', tempOutputPath,
      // Use compression to reduce size
      '--compress', 'GZip'
    ]

    // Only add --no-bytecode if not already disabled in config
    const pkgConfig = JSON.parse(readFileSync(PKG_CONFIG, 'utf8'))
    if (pkgConfig.pkg?.bytecode !== false) {
      pkgArgs.push('--no-bytecode')
    } else {
      console.log('   Note: bytecode compilation disabled in config')
    }

    const env = { ...process.env }
    if (minify) {
      env.MINIFY = '1'
    }

    let hasPlaceholderError = false
    const pkgExitCode = await new Promise((resolve) => {
      const child = spawn('pnpm', pkgArgs, {
        cwd: ROOT_DIR,
        env,
        stdio: 'pipe'
      })

      // Filter out signing warnings on macOS since we handle signing ourselves
      const shouldFilterSigningWarnings = platform === 'darwin'
      let inSigningWarning = false
      let _signingWarningBuffer = []

      if (!quiet) {
        if (child.stdout) {
          child.stdout.on('data', (data) => {
            const lines = data.toString().split('\n')
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]

              // Check if this is signing-related content we want to filter
              if (shouldFilterSigningWarnings) {
                // Start of signing warning
                if ((line.includes('Warning') && line.includes('Unable to sign')) ||
                    (line.includes('Due to the mandatory code signing'))) {
                  inSigningWarning = true
                  _signingWarningBuffer = []
                  continue
                }

                // Common signing-related lines to filter
                const signingPhrases = [
                  'executable is distributed to end users',
                  'Otherwise, it will be immediately killed',
                  'An ad-hoc signature is sufficient',
                  'To do that, run pkg on a Mac',
                  'and run "codesign --sign -',
                  'install "ldid" utility to PATH'
                ]

                if (signingPhrases.some(phrase => line.includes(phrase))) {
                  inSigningWarning = true
                  continue
                }

                // If we're in a signing warning, buffer lines
                if (inSigningWarning) {
                  if (line.trim() === '') {
                    // Empty line might end the warning
                    inSigningWarning = false
                    _signingWarningBuffer = []
                  } else if (line.startsWith('>') || line.startsWith('[') || line.includes('✓')) {
                    // New content started, warning is over
                    inSigningWarning = false
                    _signingWarningBuffer = []
                    process.stdout.write(line + (i < lines.length - 1 ? '\n' : ''))
                  }
                  continue
                }
              }

              // Output non-filtered lines
              if (i < lines.length - 1 || line !== '') {
                process.stdout.write(line + (i < lines.length - 1 ? '\n' : ''))
              }
            }
          })
        }

        if (child.stderr) {
          child.stderr.on('data', (data) => {
            const text = data.toString()

            // Check for v24 placeholder error
            if (text.includes('Placeholder for') && text.includes('not found')) {
              hasPlaceholderError = true
            }

            // Filter out ldid assertion errors that come from pkg's internal ldid usage
            if (text.includes('ldid.cpp') && text.includes('_assert()')) {
              // Suppress these warnings - they're misleading and the binary works fine
              return
            }

            // Filter out codesign errors that we handle ourselves
            if (shouldFilterSigningWarnings) {
              const signingErrors = [
                'replacing existing signature',
                'internal error in Code Signing subsystem',
                'code object is not signed at all'
              ]
              // Check if this stderr contains signing-related errors we want to suppress
              if (signingErrors.some(err => text.includes(err))) {
                // Don't output these errors
                return
              }
            }
            if (!quiet) process.stderr.write(data)
          })
        }
      }

      child.on('exit', (code) => resolve(code || 0))
      child.on('error', () => resolve(1))
    })

    // If v24 failed with placeholder error, build from source
    if (isV24 && hasPlaceholderError) {
      console.log(`\n${colors.yellow('⚠')} v24 pre-built binary has placeholder issues`)
      console.log('   Falling back to source build...\n')

      const buildResult = await buildV24FromSource(PKG_CONFIG, target, tempOutputPath, quiet)
      if (buildResult !== 0) {
        // Clean up temp directory on failure
        try { await unlink(tempDir) } catch {}
        return buildResult
      }
      // Note: Can't strip pkg-modified binaries, stripping happens on base Node before pkg
    } else if (pkgExitCode !== 0) {
      console.error(`${colors.red('✗')} pkg build failed`)
      return 1
    }
  }

  // Step 6: Sign with ldid on ARM64 macOS (if needed)
  // Note: We can't strip pkg-modified binaries, so we strip the base Node binary before pkg uses it
  if (platform === 'darwin' && arch === 'arm64' && existsSync(tempOutputPath)) {
    console.log('🔏 Signing macOS ARM64 binary with ldid...')
    const signResult = await signMacOSBinaryWithLdid(tempOutputPath, quiet)
    if (signResult === 'ldid-not-found') {
      console.error(`${colors.yellow('⚠')} Warning: ldid disappeared after install?`)
    } else if (signResult !== 0) {
      // ldid returns non-zero but still signs the binary properly
      // This is a known issue with yao-pkg binaries
      console.log(`${colors.green('✓')} Binary signed with ldid\n`)
    } else {
      console.log(`${colors.green('✓')} Binary signed with ldid successfully\n`)
    }
  }
  // For x64 or if ldid wasn't used, verify the signature
  else if (platform === 'darwin' && existsSync(tempOutputPath)) {
    console.log('🔏 Verifying macOS binary signature...')
    const isSignedProperly = await verifyMacOSBinarySignature(tempOutputPath, quiet)
    if (!isSignedProperly) {
      console.error(`${colors.yellow('⚠')} Warning: Binary may not be properly signed`)
      console.error('   The binary may not run properly')
    } else {
      console.log(`${colors.green('✓')} Binary signature verified\n`)
    }
  }

  // Step 7: Move from temp to final location
  if (existsSync(tempOutputPath)) {
    console.log('\nMoving binary to final location...')
    await rename(tempOutputPath, finalOutputPath)
    console.log(`${colors.green('✓')} Binary moved to: ${finalOutputPath}`)

    // Clean up temp directory
    try {
      const { rm } = await import('node:fs/promises')
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    } catch {}
  }

  // Step 8: Verify and report
  if (existsSync(finalOutputPath)) {
    const { stat } = await import('node:fs/promises')
    const stats = await stat(finalOutputPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1)

    console.log(`\n${colors.green('✓')} Single executable built successfully (${builder === 'yao' ? 'yao-pkg' : 'Node.js SEA'})!`)
    console.log(`   Binary: ${finalOutputPath}`)
    console.log(`   Size: ${sizeMB}MB`)
    console.log(`   Platform: ${platform}`)
    console.log(`   Architecture: ${arch}`)
    console.log(`   Node version: ${nodeVersion}`)
  } else {
    console.error(`${colors.red('✗')} Binary was not created`)
    // Clean up temp directory on failure
    try {
      const { rm } = await import('node:fs/promises')
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    } catch {}
    return 1
  }

  return 0
}

/**
 * Check and install essential build tools
 */
async function checkEssentialTools(platform, arch, quiet = false) {
  const tools = []

  // Git is essential for many operations
  tools.push({ name: 'git', installCmd: 'git' })

  // Platform-specific tools
  if (platform === 'darwin') {
    // Xcode Command Line Tools provide essential build tools
    const hasXcodeTools = await checkCommand('xcodebuild', ['-version'])
    if (!hasXcodeTools) {
      console.log('   Xcode Command Line Tools not found, installing...')
      // This will prompt for installation
      await new Promise((resolve) => {
        const child = spawn('xcode-select', ['--install'], {
          stdio: 'inherit'
        })
        child.on('exit', resolve)
        child.on('error', resolve)
      })
    }
  } else if (platform === 'linux') {
    // Linux needs build-essential
    tools.push({ name: 'make', installCmd: 'build-essential' })
    tools.push({ name: 'gcc', installCmd: 'build-essential' })
  } else if (platform === 'win32') {
    // Windows needs Visual Studio Build Tools
    // These are harder to auto-install, so just check
    const hasMSBuild = await checkCommand('msbuild', ['/version'])
    if (!hasMSBuild) {
      console.error('   Visual Studio Build Tools not found')
      console.error('   Please install from: https://visualstudio.microsoft.com/downloads/')
      return false
    }
  }

  // Check and install tools sequentially
  const installTool = async (tool) => {
    const hasCommand = await checkCommand(tool.name)
    if (!hasCommand) {
      console.log(`   ${tool.name} not found`)
      if (platform === 'darwin') {
        // Try to install via Homebrew
        const installed = await installViaHomebrew(tool.installCmd, quiet)
        if (!installed) {
          console.error(`   Failed to install ${tool.name}`)
          return false
        }
      } else if (platform === 'linux') {
        console.error(`   Please install ${tool.installCmd} manually`)
        console.error(`   Ubuntu/Debian: sudo apt-get install ${tool.installCmd}`)
        console.error(`   RHEL/Fedora: sudo dnf install ${tool.installCmd}`)
        return false
      }
    }
    return true
  }

  // Process tools sequentially (needed for dependency order)
  for (const tool of tools) {
    // eslint-disable-next-line no-await-in-loop
    const success = await installTool(tool)
    if (!success) {
      return false
    }
  }

  return true
}

/**
 * Check if a command exists
 */
async function checkCommand(command, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'pipe'
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

/**
 * Install a package via Homebrew
 */
async function installViaHomebrew(packageName, quiet = false) {
  // First ensure Homebrew is available
  let brewAvailable = await checkCommand('brew')
  if (!brewAvailable) {
    console.log('   Installing Homebrew first...')
    brewAvailable = await installHomebrew(quiet)
    if (!brewAvailable) {
      return false
    }
  }

  // Install the package
  console.log(`   Installing ${packageName} via Homebrew...`)
  return new Promise((resolve) => {
    const child = spawn('brew', ['install', packageName], {
      stdio: quiet ? 'pipe' : 'inherit'
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

/**
 * Check for ldid and install if needed
 * @returns {Promise<'available'|'newly-installed'|'not-found'>}
 */
async function checkAndInstallLdid(quiet = false) {
  // First check if ldid is already available
  const ldidAvailable = await new Promise((resolve) => {
    const child = spawn('which', ['ldid'], {
      stdio: 'pipe'
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })

  if (ldidAvailable) {
    return 'available'
  }

  // Try to install ldid
  console.log('   ldid not found, auto-installing...')
  const installed = await installLdidViaBrew(quiet)

  return installed ? 'newly-installed' : 'not-found'
}

/**
 * Install Homebrew if not available
 */
async function installHomebrew(quiet = false) {
  console.log('   Homebrew not found, installing...')
  console.log('   This may take a few minutes...')

  // Download and run Homebrew installer
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c',
      'curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | /bin/bash'
    ], {
      stdio: quiet ? 'pipe' : 'inherit',
      // Non-interactive install
      env: { ...process.env, NONINTERACTIVE: '1' }
    })

    child.on('exit', async (code) => {
      if (code === 0) {
        // Add Homebrew to PATH for Apple Silicon Macs
        if (process.arch === 'arm64') {
          process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`
        } else {
          process.env.PATH = `/usr/local/bin:${process.env.PATH}`
        }
        console.log('   Homebrew installed successfully')
        resolve(true)
      } else {
        console.error('   Failed to install Homebrew automatically')
        console.error('   Please install manually from https://brew.sh')
        resolve(false)
      }
    })
    child.on('error', (error) => {
      if (!quiet) {
        console.error('   Error installing Homebrew:', error.message)
      }
      resolve(false)
    })
  })
}

/**
 * Install ldid using Homebrew
 */
async function installLdidViaBrew(quiet = false) {
  // First check if brew is available
  let brewAvailable = await new Promise((resolve) => {
    const child = spawn('which', ['brew'], {
      stdio: 'pipe'
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })

  if (!brewAvailable) {
    // Try to install Homebrew automatically
    brewAvailable = await installHomebrew(quiet)
    if (!brewAvailable) {
      return false
    }
  }

  // Install ldid using brew
  return new Promise((resolve) => {
    console.log('   Running: brew install ldid')
    const child = spawn('brew', ['install', 'ldid'], {
      stdio: quiet ? 'pipe' : 'inherit'
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(true)
      } else {
        if (!quiet) {
          console.error('   Failed to install ldid via Homebrew')
        }
        resolve(false)
      }
    })
    child.on('error', (error) => {
      if (!quiet) {
        console.error('   Error installing ldid:', error.message)
      }
      resolve(false)
    })
  })
}

/**
 * Sign macOS ARM64 binary with ldid (fixes yao-pkg malformed binary issue)
 */
async function signMacOSBinaryWithLdid(binaryPath, quiet = false) {
  // Verify ldid is still available (should have been installed earlier)
  const ldidAvailable = await new Promise((resolve) => {
    const child = spawn('which', ['ldid'], {
      stdio: 'pipe'
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })

  if (!ldidAvailable) {
    return 'ldid-not-found'
  }

  // Remove existing signature first (if any)
  await new Promise((resolve) => {
    const child = spawn('codesign', ['--remove-signature', binaryPath], {
      stdio: 'pipe'
    })
    child.on('exit', () => resolve())
    child.on('error', () => resolve())
  })

  // Sign with ldid
  return new Promise((resolve) => {
    const child = spawn('ldid', ['-S', binaryPath], {
      stdio: 'pipe' // Always pipe to filter output
    })

    // Filter ldid stderr output
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const text = data.toString()
        // Filter out known ldid assertion errors that don't affect functionality
        if (text.includes('ldid.cpp') && text.includes('_assert()')) {
          // Suppress these warnings - they're misleading
          return
        }
        // Output other errors if not quiet
        if (!quiet) {
          process.stderr.write(data)
        }
      })
    }

    child.on('exit', async (code) => {
      // Clean up ldid temp file if it exists
      const { unlink } = await import('node:fs/promises')
      const tempFile = binaryPath.replace(/[^/]+$/, '.ldid.$&')
      try {
        await unlink(tempFile)
      } catch {
        // Ignore if file doesn't exist
      }
      resolve(code || 0)
    })
    child.on('error', (error) => {
      if (!quiet) {
        console.error('   ldid error:', error.message)
      }
      resolve(1)
    })
  })
}

/**
 * Verify macOS binary signature
 */
async function verifyMacOSBinarySignature(binaryPath, quiet = false) {
  return new Promise((resolve) => {
    const child = spawn('codesign', ['-dv', binaryPath], {
      stdio: 'pipe'
    })

    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('exit', (code) => {
      // Exit code 0 means it's properly signed
      if (!quiet && code !== 0) {
        console.error('   Signature verification failed:', stderr.trim())
      }
      resolve(code === 0)
    })
    child.on('error', () => resolve(false))
  })
}

/**
 * Sign macOS binary using codesign (DEPRECATED - pkg handles this)
 * @deprecated pkg should handle signing during build
 */
async function _signMacOSBinary(binaryPath, quiet = false) {
  // First check if already signed
  const checkSigned = await new Promise((resolve) => {
    const child = spawn('codesign', ['-dv', binaryPath], {
      stdio: 'pipe'
    })

    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('exit', (code) => {
      // Exit code 0 means it's already signed
      resolve({ signed: code === 0, output: stderr })
    })
    child.on('error', () => resolve({ signed: false, output: '' }))
  })

  if (checkSigned.signed) {
    if (!quiet) {
      console.log('   Binary is already signed')
    }
    return 0
  }

  // Sign the binary
  return new Promise((resolve) => {
    const child = spawn('codesign', ['--sign', '-', '--force', binaryPath], {
      // Always pipe to prevent stderr leakage
      stdio: 'pipe'
    })

    let stderr = ''
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
    }

    child.on('exit', (code) => {
      // Even if codesign reports an error, verify if the binary got signed
      if (code !== 0) {
        // Check again if it's signed despite the error
        const verifyChild = spawn('codesign', ['-dv', binaryPath], {
          stdio: 'pipe'
        })

        verifyChild.on('exit', (verifyCode) => {
          if (verifyCode === 0) {
            // Binary is signed despite the error
            resolve(0)
          } else {
            // Only show error if not quiet and signing actually failed
            if (!quiet && stderr && !stderr.includes('replacing existing signature')) {
              console.error(`   codesign output: ${stderr}`)
            }
            resolve(code)
          }
        })
        verifyChild.on('error', () => resolve(code))
      } else {
        resolve(0)
      }
    })

    child.on('error', (error) => {
      if (!quiet) {
        console.error(`   codesign error: ${error.message}`)
      }
      resolve(1)
    })
  })
}

/**
 * Get pkg target string
 */
function getPkgTarget(platform, arch, nodeVersion) {
  const platformMap = {
    'darwin': 'macos',
    'linux': 'linux',
    'win32': 'win'
  }

  const archMap = {
    'x64': 'x64',
    'arm64': 'arm64'
  }

  const pkgPlatform = platformMap[platform] || platform
  const pkgArch = archMap[arch] || arch
  const majorVersion = nodeVersion.match(/v(\d+)/)?.[1] || '24'

  return `node${majorVersion}-${pkgPlatform}-${pkgArch}`
}

/**
 * Get output binary name
 */
function getOutputName(platform, arch) {
  const ext = platform === 'win32' ? '.exe' : ''
  const platformName = platform === 'darwin' ? 'macos' : platform
  return `socket-${platformName}-${arch}${ext}`
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    nodeVersion: 'v24.9.0'
  }

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      options.platform = arg.split('=')[1]
    } else if (arg.startsWith('--arch=')) {
      options.arch = arg.split('=')[1]
    } else if (arg.startsWith('--node-version=')) {
      options.nodeVersion = arg.split('=')[1]
    } else if (arg === '--minify') {
      options.minify = true
    } else if (arg === '--sync-yao-patches') {
      options.syncYaoPatches = true
    } else if (arg === '--quiet') {
      options.quiet = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }

  return options
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Socket CLI Single Executable Builder
============================

Usage: node scripts/build/stub/build-stub.mjs [options]

Options:
  --platform=PLATFORM   Target platform (darwin, linux, win32)
  --arch=ARCH          Target architecture (x64, arm64)
  --node-version=VER   Node.js version (default: v24.9.0)
  --minify             Minify the build
  --sync-yao-patches   Force sync yao-pkg patches from upstream
  --quiet              Suppress output
  --help, -h           Show this help

Examples:
  # Build for current platform
  node scripts/build/stub/build-stub.mjs

  # Build for Linux x64
  node scripts/build/stub/build-stub.mjs --platform=linux --arch=x64

  # Build with different Node version
  node scripts/build/stub/build-stub.mjs --node-version=v22.19.0

  # Force sync yao-pkg patches from upstream
  node scripts/build/stub/build-stub.mjs --sync-yao-patches

Output:
  Binaries are placed in: build/output/
`)
}

// Main
async function main() {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    return 0
  }

  try {
    const exitCode = await buildStub(options)
    if (exitCode !== 0) {
      throw new Error(`Build failed with exit code ${exitCode}`)
    }
    return 0
  } catch (error) {
    console.error(`${colors.red('✗')} Build failed:`, error.message)
    throw error
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(exitCode => {
    process.exitCode = exitCode || 0
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

export default buildStub