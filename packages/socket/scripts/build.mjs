/**
 * Build script for Socket npm wrapper package.
 *
 * This script:
 * 1. Ensures @socketsecurity/bootstrap package is built
 * 2. Builds bootstrap.js for SEA builds
 * 3. Builds bootstrap-smol.js for smol builds
 * 4. Copies LICENSE, CHANGELOG.md, and logo images from repo root
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import seaConfig from './esbuild.bootstrap.config.mjs'
import smolConfig from './esbuild.bootstrap-smol.config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(packageRoot, '../..')

// Ensure bootstrap package is built before building socket wrapper.
async function ensureBootstrapPackageBuilt() {
  const bootstrapSource = path.join(
    monorepoRoot,
    'packages/bootstrap/src/bootstrap-npm.mts'
  )
  const bootstrapDist = path.join(
    monorepoRoot,
    'packages/bootstrap/dist/bootstrap-npm.js'
  )

  // Check if bootstrap source and dist exist.
  if (!existsSync(bootstrapSource)) {
    logger.error('✗ Bootstrap source not found:', bootstrapSource)
    process.exit(1)
  }

  // If dist exists, assume it's up to date.
  if (existsSync(bootstrapDist)) {
    return
  }

  logger.log('→ Building @socketsecurity/bootstrap package (dependency)...\n')

  const result = await spawn(
    'pnpm',
    ['--filter', '@socketsecurity/bootstrap', 'run', 'build'],
    {
      cwd: monorepoRoot,
      shell: WIN32,
      stdio: 'inherit',
    }
  )

  if (result.code !== 0) {
    logger.error('\n✗ Failed to build @socketsecurity/bootstrap')
    process.exit(1)
  }

  logger.log('')
}

async function copyFilesFromRepoRoot() {
  logger.log('→ Copying files from repo root...')

  const filesToCopy = [
    'CHANGELOG.md',
    'LICENSE',
    'logo-dark.png',
    'logo-light.png',
  ]

  for (const file of filesToCopy) {
    const srcPath = path.join(monorepoRoot, file)
    const destPath = path.join(packageRoot, file)

    try {
      await fs.cp(srcPath, destPath)
      logger.log(`  ✓ ${file}`)
    } catch (error) {
      logger.error(`  ✗ Failed to copy ${file}:`, error.message)
      throw error
    }
  }

  logger.log('✓ Files copied from repo root\n')
}

async function buildBootstrap() {
  logger.log('Building Socket npm wrapper bootstrap with esbuild...\n')

  try {
    // Create dist directory.
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })

    // Build standard version for SEA.
    logger.log('→ Building standard bootstrap (SEA)...')
    const seaResult = await build(seaConfig)

    logger.log(`✓ ${seaConfig.outfile}`)

    if (seaResult.metafile) {
      const outputSize = Object.values(seaResult.metafile.outputs)[0]?.bytes
      if (outputSize) {
        logger.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
      }
    }

    // Build transformed version for smol.
    logger.log('\n→ Building transformed bootstrap (smol)...')
    const smolResult = await build(smolConfig)

    // Write the transformed output (build had write: false).
    if (smolResult.outputFiles && smolResult.outputFiles.length > 0) {
      for (const output of smolResult.outputFiles) {
        writeFileSync(output.path, output.contents)
      }
    }

    logger.log(`✓ ${smolConfig.outfile}`)

    if (smolResult.metafile) {
      const outputSize = Object.values(smolResult.metafile.outputs)[0]?.bytes
      if (outputSize) {
        logger.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
      }
    }

    logger.log('\n✓ Bootstrap build completed')
  } catch (error) {
    logger.error('\n✗ Bootstrap build failed:', error)
    throw error
  }
}

async function main() {
  try {
    await ensureBootstrapPackageBuilt()
    await buildBootstrap()
    await copyFilesFromRepoRoot()
    logger.log('✓ Build completed successfully')
  } catch (error) {
    logger.error('✗ Build failed:', error)
    process.exit(1)
  }
}

main()
