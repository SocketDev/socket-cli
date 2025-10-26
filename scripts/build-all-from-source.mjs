/**
 * Build All From-Source Packages
 *
 * Orchestrates building all from-source packages in the correct order:
 * 1. build-infra (shared utilities)
 * 2. node-smol-builder (custom Node.js)
 * 3. onnx-runtime-builder (ONNX Runtime WASM)
 * 4. codet5-models-builder (CodeT5 model optimization)
 * 5. minilm-builder (MiniLM model optimization)
 * 6. yoga-layout (Yoga Layout WASM)
 *
 * Usage:
 *   node scripts/build-all-from-source.mjs           # Build all packages
 *   node scripts/build-all-from-source.mjs --force   # Force rebuild all
 *   node scripts/build-all-from-source.mjs node-smol-builder # Build specific package
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
const specificPackage = args.find((arg) => !arg.startsWith('--'))

// Build packages in order (dependencies first).
const PACKAGES = [
  {
    name: 'build-infra',
    description: 'Shared build infrastructure',
    path: 'packages/build-infra',
    build: false, // No build needed (utilities only)
  },
  {
    name: 'node-smol-builder',
    description: 'Custom Node.js runtime',
    path: 'packages/node-smol-builder',
    build: true,
  },
  {
    name: 'onnx-runtime-builder',
    description: 'ONNX Runtime WASM',
    path: 'packages/onnx-runtime-builder',
    build: true,
  },
  {
    name: 'codet5-models-builder',
    description: 'CodeT5 model optimization',
    path: 'packages/codet5-models-builder',
    build: true,
  },
  {
    name: 'minilm-builder',
    description: 'MiniLM model optimization',
    path: 'packages/minilm-builder',
    build: true,
  },
  {
    name: 'yoga-layout',
    description: 'Yoga Layout WASM',
    path: 'packages/yoga-layout',
    build: true,
  },
]

/**
 * Build a specific package.
 */
async function buildPackage(pkg) {
  logger.step(`Building ${pkg.name}`)
  logger.info(`  ${pkg.description}`)
  logger.info('')

  if (!pkg.build) {
    logger.info(`  Skipping ${pkg.name} (no build needed)`)
    logger.info('')
    return
  }

  const packageDir = path.join(ROOT_DIR, pkg.path)
  const buildScript = path.join(packageDir, 'scripts', 'build.mjs')

  const buildArgs = ['node', buildScript]
  if (FORCE_BUILD) {
    buildArgs.push('--force')
  }

  const startTime = Date.now()

  try {
    const result = await spawn(buildArgs[0], buildArgs.slice(1), {
      cwd: packageDir,
      shell: true,
      stdio: 'inherit',
    })

    if (result.status !== 0) {
      throw new Error(`Build failed with exit code ${result.status}`)
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    logger.success(`${pkg.name} built successfully in ${duration}s`)
    logger.info('')
  } catch (e) {
    logger.fail(`Failed to build ${pkg.name}: ${e.message}`)
    throw e
  }
}

/**
 * Main function.
 */
async function main() {
  const totalStart = Date.now()

  logger.log('')
  logger.log('🔨 Building All From-Source Packages')
  logger.log('')

  if (FORCE_BUILD) {
    logger.warn('Force rebuild enabled (ignoring checkpoints)')
    logger.log('')
  }

  // Filter packages if specific package requested.
  let packagesToBuild = PACKAGES

  if (specificPackage) {
    const pkg = PACKAGES.find((p) => p.name === specificPackage)
    if (!pkg) {
      logger.fail(`Unknown package: ${specificPackage}`)
      logger.info('')
      logger.info('Available packages:')
      for (const p of PACKAGES) {
        logger.info(`  - ${p.name}: ${p.description}`)
      }
      process.exit(1)
    }
    packagesToBuild = [pkg]
    logger.info(`Building specific package: ${pkg.name}`)
    logger.info('')
  } else {
    logger.info('Building all packages in order:')
    for (const pkg of PACKAGES) {
      if (pkg.build) {
        logger.info(`  ${pkg.name} - ${pkg.description}`)
      }
    }
    logger.info('')
  }

  // Build packages in order.
  for (const pkg of packagesToBuild) {
    await buildPackage(pkg)
  }

  // Report completion.
  const totalDuration = Math.round((Date.now() - totalStart) / 1000)
  const totalMinutes = Math.floor(totalDuration / 60)
  const totalSeconds = totalDuration % 60

  logger.log('━'.repeat(60))
  logger.log('')
  logger.success('🎉 All packages built successfully!')
  logger.log('')
  logger.info(`Total time: ${totalMinutes}m ${totalSeconds}s`)
  logger.log('')
  logger.info('Build artifacts:')
  logger.info('  node-smol-builder:      packages/node-smol-builder/build/out/Release/node')
  logger.info('  onnx-runtime:   packages/onnx-runtime/build/wasm/')
  logger.info('  codet5-models:  packages/codet5-models/build/models/')
  logger.info('  yoga-layout:    packages/yoga-layout/build/wasm/')
  logger.log('')
  logger.info('Next steps:')
  logger.info('  1. Test built artifacts')
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('  3. Run Socket CLI build: pnpm run build')
  logger.log('')
}

// Run main function.
main().catch((e) => {
  logger.fail(`Build failed: ${e.message}`)
  process.exit(1)
})
