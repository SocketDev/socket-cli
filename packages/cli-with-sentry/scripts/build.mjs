/**
 * @fileoverview Build script for Socket CLI with Sentry.
 * Delegates to esbuild config for actual build.
 * Copies data/ and images from packages/cli.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const repoRoot = path.join(__dirname, '../../..')

async function main() {
  try {
    const cliPath = path.join(rootPath, '..', 'cli')

    // Build CLI bundle.
    logger.info('Building CLI bundle...')
    let result = await spawn('node', ['.config/esbuild.config.mjs'], {
      shell: WIN32,
      stdio: 'inherit',
      cwd: rootPath,
      env: {
        ...process.env,
        INLINED_SOCKET_CLI_SENTRY_BUILD: '1',
      },
    })
    if (result.code !== 0) {
      throw new Error(`CLI bundle build failed with exit code ${result.code}`)
    }
    logger.success('Built CLI bundle')

    // Build index loader.
    logger.info('Building index loader...')
    result = await spawn('node', ['.config/esbuild.index.config.mjs'], {
      shell: WIN32,
      stdio: 'inherit',
      cwd: rootPath,
    })
    if (result.code !== 0) {
      throw new Error(`Index loader build failed with exit code ${result.code}`)
    }
    logger.success('Built index loader')

    // Build shadow npm inject.
    logger.info('Building shadow npm inject...')
    result = await spawn('node', ['.config/esbuild.inject.config.mjs'], {
      shell: WIN32,
      stdio: 'inherit',
      cwd: rootPath,
    })
    if (result.code !== 0) {
      throw new Error(`Shadow npm inject build failed with exit code ${result.code}`)
    }
    logger.success('Built shadow npm inject')

    // Compress CLI.
    logger.info('Compressing CLI...')
    result = await spawn('node', ['scripts/compress-cli.mjs'], {
      shell: WIN32,
      stdio: 'inherit',
      cwd: rootPath,
    })
    if (result.code !== 0) {
      throw new Error(`CLI compression failed with exit code ${result.code}`)
    }
    logger.success('Compressed CLI')

    // Copy data directory from packages/cli.
    logger.info('Copying data/ from packages/cli...')
    await fs.cp(path.join(cliPath, 'data'), path.join(rootPath, 'data'), {
      recursive: true,
    })
    logger.success('Copied data/')

    // Copy files from repo root.
    logger.info('Copying files from repo root...')
    const filesToCopy = [
      'CHANGELOG.md',
      'LICENSE',
      'logo-dark.png',
      'logo-light.png',
    ]
    for (const file of filesToCopy) {
      await fs.cp(path.join(repoRoot, file), path.join(rootPath, file))
    }
    logger.success('Copied files from repo root')
  } catch (error) {
    logger.error(`Build failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
