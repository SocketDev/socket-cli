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
import { getSpinner } from '@socketsecurity/lib/constants/process'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { Spinner, withSpinner } from '@socketsecurity/lib/spinner'
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

  logger.group('Checking bootstrap package')

  // Check if bootstrap source and dist exist.
  if (!existsSync(bootstrapSource)) {
    logger.groupEnd()
    logger.error('Bootstrap source not found:', bootstrapSource)
    process.exit(1)
  }

  // If dist exists, assume it's up to date.
  if (existsSync(bootstrapDist)) {
    logger.substep('Bootstrap package already built')
    logger.groupEnd()
    return
  }

  logger.substep('Bootstrap package needs building')
  logger.groupEnd()

  const result = await withSpinner({
    message: 'Building @socketsecurity/bootstrap package',
    spinner: Spinner({ shimmer: { dir: 'ltr' } }),
    operation: async () => {
      const spawnResult = await spawn(
        'pnpm',
        ['--filter', '@socketsecurity/bootstrap', 'run', 'build'],
        {
          cwd: monorepoRoot,
          shell: WIN32,
          stdio: 'pipe',
        }
      )

      if (spawnResult.code !== 0) {
        throw new Error('Failed to build @socketsecurity/bootstrap')
      }

      return spawnResult
    },
  })

  if (result.code !== 0) {
    logger.error('Failed to build @socketsecurity/bootstrap')
    process.exit(1)
  }
}

async function copyFilesFromRepoRoot() {
  const filesToCopy = [
    'CHANGELOG.md',
    'LICENSE',
    'logo-dark.png',
    'logo-light.png',
  ]

  await withSpinner({
    message: 'Copying files from repo root',
    spinner: Spinner({ shimmer: { dir: 'ltr' } }),
    operation: async () => {
      logger.group('Copying assets')

      for (const file of filesToCopy) {
        const srcPath = path.join(monorepoRoot, file)
        const destPath = path.join(packageRoot, file)

        try {
          await fs.cp(srcPath, destPath)
          logger.substep(`Copied ${file}`)
        } catch (error) {
          logger.groupEnd()
          throw new Error(`Failed to copy ${file}: ${error.message}`)
        }
      }

      logger.groupEnd()
    },
  })
}

async function buildBootstrap() {
  logger.group('Building bootstrap bundles')

  try {
    // Create dist directory.
    logger.substep('Creating dist directory')
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })

    // Build standard version for SEA.
    const seaResult = await withSpinner({
      message: 'Building standard bootstrap (SEA)',
      spinner: Spinner({ shimmer: { dir: 'ltr' } }),
      operation: async () => {
        const result = await build(seaConfig)
        return result
      },
    })

    if (seaResult.metafile) {
      const outputSize = Object.values(seaResult.metafile.outputs)[0]?.bytes
      if (outputSize) {
        logger.substep(`SEA bundle: ${(outputSize / 1024).toFixed(2)} KB`)
      }
    }

    // Build transformed version for smol.
    const smolResult = await withSpinner({
      message: 'Building transformed bootstrap (smol)',
      spinner: Spinner({ shimmer: { dir: 'ltr' } }),
      operation: async () => {
        const result = await build(smolConfig)

        // Write the transformed output (build had write: false).
        if (result.outputFiles && result.outputFiles.length > 0) {
          for (const output of result.outputFiles) {
            writeFileSync(output.path, output.contents)
          }
        }

        return result
      },
    })

    if (smolResult.metafile) {
      const outputSize = Object.values(smolResult.metafile.outputs)[0]?.bytes
      if (outputSize) {
        logger.substep(`Smol bundle: ${(outputSize / 1024).toFixed(2)} KB`)
      }
    }

    logger.groupEnd()
  } catch (error) {
    logger.groupEnd()
    logger.error('Bootstrap build failed:', error)
    throw error
  }
}

async function main() {
  logger.group('Socket Package Build')

  try {
    await ensureBootstrapPackageBuilt()
    await buildBootstrap()
    await copyFilesFromRepoRoot()

    logger.groupEnd()
    logger.success('Build completed successfully')
  } catch (error) {
    logger.groupEnd()
    logger.error('Build failed:', error)
    process.exit(1)
  }
}

main()
