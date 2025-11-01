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

import { getDefaultLogger } from '@socketsecurity/lib/logger'
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
  getDefaultLogger().step(`Building ${pkg.name}`)
  getDefaultLogger().info(`  ${pkg.description}`)
  getDefaultLogger().info('')

  if (!pkg.build) {
    getDefaultLogger().info(`  Skipping ${pkg.name} (no build needed)`)
    getDefaultLogger().info('')
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

    if (result.code !== 0) {
      throw new Error(`Build failed with exit code ${result.code}`)
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    getDefaultLogger().success(`${pkg.name} built successfully in ${duration}s`)
    getDefaultLogger().info('')
  } catch (e) {
    getDefaultLogger().fail(`Failed to build ${pkg.name}: ${e.message}`)
    throw e
  }
}

/**
 * Main function.
 */
async function main() {
  const totalStart = Date.now()

  getDefaultLogger().log('')
  getDefaultLogger().log('🔨 Building All From-Source Packages')
  getDefaultLogger().log('')

  if (FORCE_BUILD) {
    getDefaultLogger().warn('Force rebuild enabled (ignoring checkpoints)')
    getDefaultLogger().log('')
  }

  // Filter packages if specific package requested.
  let packagesToBuild = PACKAGES

  if (specificPackage) {
    const pkg = PACKAGES.find((p) => p.name === specificPackage)
    if (!pkg) {
      getDefaultLogger().fail(`Unknown package: ${specificPackage}`)
      getDefaultLogger().info('')
      getDefaultLogger().info('Available packages:')
      for (const p of PACKAGES) {
        getDefaultLogger().info(`  - ${p.name}: ${p.description}`)
      }
      process.exit(1)
    }
    packagesToBuild = [pkg]
    getDefaultLogger().info(`Building specific package: ${pkg.name}`)
    getDefaultLogger().info('')
  } else {
    getDefaultLogger().info('Building all packages in order:')
    for (const pkg of PACKAGES) {
      if (pkg.build) {
        getDefaultLogger().info(`  ${pkg.name} - ${pkg.description}`)
      }
    }
    getDefaultLogger().info('')
  }

  // Build packages in order.
  for (const pkg of packagesToBuild) {
    await buildPackage(pkg)
  }

  // Report completion.
  const totalDuration = Math.round((Date.now() - totalStart) / 1000)
  const totalMinutes = Math.floor(totalDuration / 60)
  const totalSeconds = totalDuration % 60

  getDefaultLogger().log('━'.repeat(60))
  getDefaultLogger().log('')
  getDefaultLogger().success('🎉 All packages built successfully!')
  getDefaultLogger().log('')
  getDefaultLogger().info(`Total time: ${totalMinutes}m ${totalSeconds}s`)
  getDefaultLogger().log('')
  getDefaultLogger().info('Build artifacts:')
  getDefaultLogger().info('  node-smol-builder:      packages/node-smol-builder/build/out/Release/node')
  getDefaultLogger().info('  onnx-runtime:   packages/onnx-runtime/build/wasm/')
  getDefaultLogger().info('  codet5-models:  packages/codet5-models/build/models/')
  getDefaultLogger().info('  yoga-layout:    packages/yoga-layout/build/wasm/')
  getDefaultLogger().log('')
  getDefaultLogger().info('Next steps:')
  getDefaultLogger().info('  1. Test built artifacts')
  getDefaultLogger().info('  2. Integrate with Socket CLI build')
  getDefaultLogger().info('  3. Run Socket CLI build: pnpm run build')
  getDefaultLogger().log('')
}

// Run main function.
main().catch((e) => {
  getDefaultLogger().fail(`Build failed: ${e.message}`)
  process.exit(1)
})
