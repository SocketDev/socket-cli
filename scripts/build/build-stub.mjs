
/**
 * @fileoverview Build stub/SEA (Single Executable Application) binaries
 *
 * This script orchestrates the creation of standalone executables using
 * yao-pkg with custom Node.js builds.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { default as ensureCustomNodeInCache } from './ensure-node-in-cache.mjs'
import syncPatches from './stub/sync-yao-patches.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const STUB_DIR = join(ROOT_DIR, 'binaries', 'stub')
const DIST_DIR = join(ROOT_DIR, 'dist')
const PKG_CONFIG = join(ROOT_DIR, '.config', 'pkg.json')

/**
 * Build stub/SEA binary
 *
 * Build flow:
 * 1. Sync yao-pkg patches from GitHub (cached for 24 hours)
 * 2. Build distribution JavaScript if needed (dist/cli.js)
 * 3. Ensure custom Node.js binary exists in pkg cache
 * 4. Use yao-pkg to create self-contained executable
 *
 * Output: binaries/stub/socket-{platform}-{arch}[.exe]
 */
export async function buildStub(options = {}) {
  const {
    arch = process.arch,
    minify = false,
    nodeVersion = 'v24.9.0',
    platform = process.platform,
    quiet = false
  } = options

  console.log('🚀 Building Stub/SEA Binary')
  console.log('============================\n')

  // Step 0: Sync yao-pkg patches if needed
  await syncPatches({ quiet })

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
      console.error('❌ Failed to build distribution files')
      return 1
    }
    console.log('✅ Distribution files built\n')
  }

  // Step 2: Ensure custom Node binary exists in cache
  const customNodeScript = join(__dirname, 'build-tiny-node.mjs')

  console.log('🔧 Ensuring custom Node.js binary...')

  try {
    const cachePath = await ensureCustomNodeInCache(nodeVersion, platform, arch)
    console.log(`✅ Custom Node ready: ${cachePath}\n`)
  } catch (error) {
    console.error(`❌ Failed to prepare custom Node: ${error.message}`)

    console.log('\n📝 To build custom Node.js:')
    console.log(`   node ${customNodeScript} --version=${nodeVersion}`)
    return 1
  }

  // Step 3: Create output directory
  await mkdir(STUB_DIR, { recursive: true })

  // Step 4: Build with pkg
  const target = getPkgTarget(platform, arch, nodeVersion)
  const outputName = getOutputName(platform, arch)
  const outputPath = join(STUB_DIR, outputName)

  console.log('📦 Building with yao-pkg...')
  console.log(`   Target: ${target}`)
  console.log(`   Output: ${outputPath}`)
  console.log()

  const pkgArgs = [
    'exec', 'pkg',
    PKG_CONFIG,
    '--targets', target,
    '--output', outputPath,
    // Avoid bytecode compilation which can cause malformed binaries
    '--no-bytecode',
    // Use compression to reduce size
    '--compress', 'GZip'
  ]

  const env = { ...process.env }
  if (minify) {
    env.MINIFY = '1'
  }

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
                } else if (line.startsWith('>') || line.startsWith('[') || line.includes('✅') || line.includes('📦')) {
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
          process.stderr.write(data)
        })
      }
    }

    child.on('exit', (code) => resolve(code || 0))
    child.on('error', () => resolve(1))
  })

  if (pkgExitCode !== 0) {
    console.error('❌ pkg build failed')
    return 1
  }

  // Step 5: Sign with ldid on ARM64 macOS (fixes yao-pkg malformed binary issue)
  if (platform === 'darwin' && arch === 'arm64' && existsSync(outputPath)) {
    console.log('🔏 Signing macOS ARM64 binary...')
    const signResult = await signMacOSBinaryWithLdid(outputPath, quiet)
    if (signResult === 'ldid-not-found') {
      console.error('⚠️  Warning: ldid not found - binary may be malformed')
      console.error('   Install ldid to fix: brew install ldid')
      console.error('   Then manually sign: ldid -S ./binaries/stub/socket-macos-arm64')
    } else if (signResult !== 0) {
      console.error('⚠️  Warning: Failed to sign with ldid')
    } else {
      console.log('✅ Binary signed with ldid successfully\n')
    }
  }
  // For x64 or if ldid wasn't used, verify the signature
  else if (platform === 'darwin' && existsSync(outputPath)) {
    console.log('🔏 Verifying macOS binary signature...')
    const isSignedProperly = await verifyMacOSBinarySignature(outputPath, quiet)
    if (!isSignedProperly) {
      console.error('⚠️  Warning: Binary may not be properly signed')
      console.error('   The binary may not run properly')
    } else {
      console.log('✅ Binary signature verified\n')
    }
  }

  // Step 6: Verify and report
  if (existsSync(outputPath)) {
    const { stat } = await import('node:fs/promises')
    const stats = await stat(outputPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1)

    console.log('\n✅ Stub/SEA binary built successfully!')
    console.log(`   Binary: ${outputPath}`)
    console.log(`   Size: ${sizeMB}MB`)
    console.log(`   Platform: ${platform}`)
    console.log(`   Architecture: ${arch}`)
    console.log(`   Node version: ${nodeVersion}`)
  } else {
    console.error('❌ Binary was not created')
    return 1
  }

  return 0
}

/**
 * Sign macOS ARM64 binary with ldid (fixes yao-pkg malformed binary issue)
 */
async function signMacOSBinaryWithLdid(binaryPath, quiet = false) {
  // First check if ldid is available
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
      stdio: quiet ? 'pipe' : 'inherit'
    })

    child.on('exit', (code) => {
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
  console.log(`Socket CLI Stub/SEA Builder
============================

Usage: node scripts/build/stub/build-stub.mjs [options]

Options:
  --platform=PLATFORM   Target platform (darwin, linux, win32)
  --arch=ARCH          Target architecture (x64, arm64)
  --node-version=VER   Node.js version (default: v24.9.0)
  --minify             Minify the build
  --quiet              Suppress output
  --help, -h           Show this help

Examples:
  # Build for current platform
  node scripts/build/stub/build-stub.mjs

  # Build for Linux x64
  node scripts/build/stub/build-stub.mjs --platform=linux --arch=x64

  # Build with different Node version
  node scripts/build/stub/build-stub.mjs --node-version=v22.19.0

Output:
  Binaries are placed in: build/stub/
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
    console.error('❌ Build failed:', error.message)
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