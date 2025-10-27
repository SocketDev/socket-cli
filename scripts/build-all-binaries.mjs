#!/usr/bin/env node
/**
 * Master Build Orchestration Script
 *
 * Builds all components in correct order:
 * 1. WASM components (yoga, onnx-runtime, models)
 * 2. Custom Node.js (node-smol-builder)
 * 3. SEA binaries (node-sea-builder) for all platforms
 * 4. Organize builds in build/ directories
 *
 * Usage:
 *   node scripts/build-all-binaries.mjs                    # Build current platform only
 *   node scripts/build-all-binaries.mjs --all-platforms    # Build all 8 platforms (requires Docker/cross-compile)
 *   node scripts/build-all-binaries.mjs --smol-only        # Build only smol variant
 *   node scripts/build-all-binaries.mjs --sea-only         # Build only SEA variant
 *   node scripts/build-all-binaries.mjs --wasm-only        # Build only WASM components
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { platform as osPlatform, arch as osArch } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.join(__dirname, '..')

// Parse arguments.
const args = process.argv.slice(2)
const BUILD_ALL_PLATFORMS = args.includes('--all-platforms')
const BUILD_SMOL_ONLY = args.includes('--smol-only')
const BUILD_SEA_ONLY = args.includes('--sea-only')
const BUILD_WASM_ONLY = args.includes('--wasm-only')
const SKIP_WASM = args.includes('--skip-wasm')

// Platform definitions.
const PLATFORMS = [
  'alpine-arm64',
  'alpine-x64',
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]

/**
 * Get current platform identifier.
 */
function getCurrentPlatform() {
  const platform = osPlatform()
  const arch = osArch()

  // Map Node.js platform/arch to our naming convention.
  const platformMap = {
    darwin: { arm64: 'darwin-arm64', x64: 'darwin-x64' },
    linux: { arm64: 'linux-arm64', x64: 'linux-x64' },
    win32: { arm64: 'win32-arm64', x64: 'win32-x64' },
  }

  return platformMap[platform]?.[arch] || `${platform}-${arch}`
}

/**
 * Execute a command and return result.
 */
async function exec(command, args, options = {}) {
  logger.info(`$ ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}`)
  }

  return result
}

/**
 * Build WASM components.
 */
async function buildWasmComponents() {
  logger.step('Building WASM Components')
  logger.info('')

  const wasmPackages = ['yoga-layout']

  for (const pkg of wasmPackages) {
    logger.substep(`Building ${pkg}`)

    const pkgDir = path.join(rootDir, 'packages', pkg)
    const buildScript = path.join(pkgDir, 'scripts', 'build.mjs')

    if (!existsSync(buildScript)) {
      logger.warn(`  Skipping ${pkg} (no build script)`)
      continue
    }

    await exec('node', [buildScript], { cwd: pkgDir })
    logger.success(`  ✓ ${pkg} built`)
    logger.info('')
  }

  logger.success('✓ All WASM components built')
  logger.info('')
}

/**
 * Build model packages.
 */
async function buildModelPackages() {
  logger.step('Building Model Packages')
  logger.info('')

  const modelPackages = [
    'onnx-runtime-builder',
    'codet5-models-builder',
    'minilm-builder',
  ]

  for (const pkg of modelPackages) {
    logger.substep(`Building ${pkg}`)

    const pkgDir = path.join(rootDir, 'packages', pkg)
    const buildScript = path.join(pkgDir, 'scripts', 'build.mjs')

    if (!existsSync(buildScript)) {
      logger.warn(`  Skipping ${pkg} (no build script)`)
      continue
    }

    // Model builders may be placeholders for now.
    logger.info(`  Note: ${pkg} may be a placeholder`)

    await exec('node', [buildScript], { cwd: pkgDir })
    logger.success(`  ✓ ${pkg} built`)
    logger.info('')
  }

  logger.success('✓ All model packages processed')
  logger.info('')
}

/**
 * Build custom Node.js (smol variant).
 */
async function buildNodeSmol(targetPlatform) {
  logger.step(`Building node-smol-builder (${targetPlatform})`)
  logger.info('')

  const pkgDir = path.join(rootDir, 'packages', 'node-smol-builder')
  const buildScript = path.join(pkgDir, 'scripts', 'build.mjs')

  // Create build directory structure.
  const buildDir = path.join(pkgDir, 'build', `cli-${targetPlatform}`)
  await mkdir(buildDir, { recursive: true })

  logger.info(`  Target: ${buildDir}`)
  logger.info('')

  if (!existsSync(buildScript)) {
    logger.error('  ✗ No build script found for node-smol-builder')
    return
  }

  // Build custom Node.js.
  await exec('node', [buildScript], { cwd: pkgDir })

  logger.success(`✓ node-smol-builder built for ${targetPlatform}`)
  logger.info('')
}

/**
 * Build SEA binaries.
 */
async function buildNodeSEA(targetPlatform) {
  logger.step(`Building node-sea-builder (${targetPlatform})`)
  logger.info('')

  const pkgDir = path.join(rootDir, 'packages', 'node-sea-builder')
  const buildScript = path.join(pkgDir, 'scripts', 'build.mjs')

  // Create build directory structure.
  const buildDir = path.join(pkgDir, 'build', `cli-${targetPlatform}`)
  await mkdir(buildDir, { recursive: true })

  logger.info(`  Target: ${buildDir}`)
  logger.info('')

  if (!existsSync(buildScript)) {
    logger.error('  ✗ No build script found for node-sea-builder')
    return
  }

  // Build SEA binary.
  await exec('node', [buildScript, '--platform', targetPlatform], {
    cwd: pkgDir,
  })

  logger.success(`✓ node-sea-builder built for ${targetPlatform}`)
  logger.info('')
}

/**
 * Main entry point.
 */
async function main() {
  const startTime = Date.now()

  logger.info('⚡ Socket CLI Master Build')
  logger.info('='.repeat(60))
  logger.info('')

  // Determine which platforms to build.
  const currentPlatform = getCurrentPlatform()
  const platformsToBuild = BUILD_ALL_PLATFORMS
    ? PLATFORMS
    : [currentPlatform]

  logger.info(`Current platform: ${currentPlatform}`)
  logger.info(`Building for: ${platformsToBuild.join(', ')}`)
  logger.info('')

  // Phase 1: WASM Components.
  if (!BUILD_SEA_ONLY && !BUILD_SMOL_ONLY && !SKIP_WASM) {
    await buildWasmComponents()
    await buildModelPackages()

    if (BUILD_WASM_ONLY) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      logger.success(`\n✅ WASM build complete in ${duration}s!`)
      return
    }
  }

  // Phase 2: Build for each platform.
  for (const platform of platformsToBuild) {
    logger.info(`\n${'='.repeat(60)}`)
    logger.info(`Building platform: ${platform}`)
    logger.info('='.repeat(60))
    logger.info('')

    // Build smol variant.
    if (!BUILD_SEA_ONLY) {
      await buildNodeSmol(platform)
    }

    // Build SEA variant.
    if (!BUILD_SMOL_ONLY) {
      await buildNodeSEA(platform)
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  logger.info('\n' + '='.repeat(60))
  logger.info('📊 Build Summary')
  logger.info('='.repeat(60))
  logger.info('')
  logger.info(`Platforms built: ${platformsToBuild.length}`)
  logger.info(`Total time: ${duration}s`)
  logger.info('')

  logger.success('✅ All builds complete!')
}

main().catch(error => {
  logger.error('\n❌ Build failed:', error.message)
  if (error.stack) {
    logger.error(error.stack)
  }
  process.exit(1)
})
