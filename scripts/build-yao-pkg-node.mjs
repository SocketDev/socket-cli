/**
 * @fileoverview Build custom Node.js v24.9.0 with yao-pkg patches
 *
 * This script produces a patched Node binary for use with @yao-pkg/pkg.
 * It downloads Node.js source, applies yao-pkg patches, configures with
 * size optimizations, and builds a custom binary.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { cpus, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/registry/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Configuration
const NODE_VERSION = 'v24.9.0'
const ROOT_DIR = join(__dirname, '..')
const BUILD_DIR = join(ROOT_DIR, '.custom-node-build')
const NODE_DIR = join(BUILD_DIR, 'node-yao-pkg')
const PATCHES_DIR = join(BUILD_DIR, 'patches')
const PATCH_FILE = join(PATCHES_DIR, 'node.v24.9.0.cpp.patch')
const PATCH_URL =
  'https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.9.0.cpp.patch'

const CPU_COUNT = cpus().length
const IS_MACOS = platform() === 'darwin'
const ARCH = process.arch

/**
 * Execute a command and stream output
 */
async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  console.log(`$ ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.code !== 0) {
    throw new Error(
      `Command failed with exit code ${result.code}: ${command} ${args.join(' ')}`,
    )
  }

  return result
}

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

  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }

  return result.stdout.trim()
}

/**
 * Get file size in human-readable format
 */
async function getFileSize(filePath) {
  const result = await execCapture('du', ['-h', filePath])
  return result.split('\t')[0]
}

/**
 * Main build function
 */
async function main() {
  console.log(`🔨 Building yao-pkg patched Node.js ${NODE_VERSION}`)
  console.log()

  // Ensure patches directory exists
  await mkdir(PATCHES_DIR, { recursive: true })

  // Check if patch file exists, download if not
  if (!existsSync(PATCH_FILE)) {
    console.log('📥 Downloading yao-pkg patch...')
    await exec('curl', ['-sL', PATCH_URL, '-o', PATCH_FILE])
    console.log(`✅ Patch downloaded to ${PATCH_FILE}`)
    console.log()
  }

  // Ensure build directory exists
  await mkdir(BUILD_DIR, { recursive: true })

  // Clone or reset Node.js repository
  if (!existsSync(NODE_DIR)) {
    console.log(`📥 Cloning Node.js ${NODE_VERSION}...`)
    await exec(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--branch',
        NODE_VERSION,
        'https://github.com/nodejs/node.git',
        'node-yao-pkg',
      ],
      { cwd: BUILD_DIR },
    )
    console.log()
  } else {
    console.log('📂 Using existing Node.js clone...')
    console.log('   Resetting to clean state...')
    await exec('git', ['reset', '--hard', NODE_VERSION], { cwd: NODE_DIR })
    await exec('git', ['clean', '-fdx'], { cwd: NODE_DIR })
    console.log()
  }

  // Apply yao-pkg patch
  console.log('🩹 Applying yao-pkg patch...')

  // Apply patch using shell redirection (simpler than piping through spawn)
  try {
    await exec('sh', ['-c', `patch -p1 < "${PATCH_FILE}"`], { cwd: NODE_DIR })
    console.log('✅ Patch applied successfully')
    console.log()
  } catch {
    console.error('❌ Patch failed to apply')
    console.error('   Checking patch status...')
    try {
      await exec('sh', ['-c', `patch -p1 --dry-run < "${PATCH_FILE}"`], {
        cwd: NODE_DIR,
      })
    } catch {
      // Show dry-run error
    }
    throw new Error('Failed to apply yao-pkg patch')
  }

  // Configure Node.js with optimizations
  console.log('⚙️  Configuring Node.js...')
  console.log(
    '   KEEP: V8 full compiler (bytecode), WASM support, JIT, SSL/crypto',
  )
  console.log('   REMOVE: npm, corepack, inspector, amaro, sqlite')
  console.log('   ICU: small-icu (English-only)')
  console.log()

  await exec(
    './configure',
    [
      '--with-intl=small-icu',
      '--without-npm',
      '--without-corepack',
      '--without-inspector',
      '--without-amaro',
      '--without-sqlite',
    ],
    { cwd: NODE_DIR },
  )
  console.log()

  // Build Node.js
  console.log('🏗️  Building Node.js (this will take 30-60 minutes)...')
  console.log(`   Using ${CPU_COUNT} CPU cores`)
  console.log()

  await exec('make', [`-j${CPU_COUNT}`], { cwd: NODE_DIR })
  console.log()

  // Test the binary
  console.log('✅ Testing binary...')
  const nodeBinary = join(NODE_DIR, 'out', 'Release', 'node')

  await exec(nodeBinary, ['--version'], {
    env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
  })

  await exec(
    nodeBinary,
    ['-e', 'console.log("Hello from yao-pkg patched Node.js!")'],
    {
      env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' },
    },
  )
  console.log()

  // Sign for macOS ARM64
  if (IS_MACOS && ARCH === 'arm64') {
    console.log('🔏 Signing binary for macOS ARM64...')
    await exec('codesign', ['--sign', '-', '--force', nodeBinary])

    const sigInfo = await execCapture('codesign', ['-dv', nodeBinary], {
      env: { ...process.env, STDERR: '>&1' },
    })
    console.log(sigInfo)
    console.log()
  }

  // Report build complete
  const binarySize = await getFileSize(nodeBinary)

  console.log()
  console.log('🎉 Build complete!')
  console.log(`   Binary: ${nodeBinary}`)
  console.log(`   Size: ${binarySize}`)
  console.log()
  console.log('📝 To use with yao-pkg, update pkg.json:')
  console.log('   {')
  console.log(`     "node": "${nodeBinary}",`)
  console.log('     ...')
  console.log('   }')
  console.log()
}

// Run main function
main().catch(error => {
  console.error('❌ Build failed:', error.message)
  throw error
})
