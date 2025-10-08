#!/usr/bin/env node

/**
 * @fileoverview Build stub/SEA (Single Executable Application) binaries
 *
 * This script orchestrates the creation of standalone executables using
 * yao-pkg with custom Node.js builds.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import ensureCustomNodeInCache from './ensure-node-in-cache.mjs'
import syncPatches from './stub/sync-yao-patches.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const BUILD_DIR = join(ROOT_DIR, 'build')
const STUB_DIR = join(BUILD_DIR, 'stub')
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
 * Output: build/stub/socket-{platform}-{arch}[.exe]
 */
export async function buildStub(options = {}) {
  const {
    platform = process.platform,
    arch = process.arch,
    nodeVersion = 'v24.9.0',
    minify = false,
    quiet = false
  } = options

  console.log('🚀 Building Stub/SEA Binary')
  console.log('============================\n')

  // Step 0: Sync yao-pkg patches if needed
  await syncPatches({ quiet })

  // Step 1: Ensure distribution files exist
  if (!existsSync(DIST_DIR) || !existsSync(join(DIST_DIR, 'cli.js'))) {
    console.log('📦 Building distribution files first...')

    const buildResult = await spawn('pnpm', ['run', 'build:dist:src'], {
      cwd: ROOT_DIR,
      stdio: quiet ? 'pipe' : 'inherit'
    })

    if (buildResult.code !== 0) {
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
    '--output', outputPath
  ]

  const env = { ...process.env }
  if (minify) {
    env.MINIFY = '1'
  }

  const pkgResult = await spawn('pnpm', pkgArgs, {
    cwd: ROOT_DIR,
    env,
    stdio: quiet ? 'pipe' : 'inherit'
  })

  if (pkgResult.code !== 0) {
    console.error('❌ pkg build failed')
    return 1
  }

  // Step 5: Verify and report
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
    process.exit(0)
  }

  try {
    const exitCode = await buildStub(options)
    process.exit(exitCode)
  } catch (error) {
    console.error('❌ Build failed:', error.message)
    process.exit(1)
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

export default buildStub