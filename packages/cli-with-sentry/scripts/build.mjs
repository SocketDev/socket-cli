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
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const repoRoot = path.join(__dirname, '../../..')

async function main() {
  try {
    const cliPath = path.join(rootPath, '..', 'cli')

    // Build CLI bundle.
    logger.log(`${colors.blue('ℹ')} Building CLI bundle...`)
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
    logger.log(`${colors.green('✓')} Built CLI bundle`)

    // Build index loader.
    logger.log(`${colors.blue('ℹ')} Building index loader...`)
    result = await spawn('node', ['.config/esbuild.index.config.mjs'], {
      shell: WIN32,
      stdio: 'inherit',
      cwd: rootPath,
    })
    if (result.code !== 0) {
      throw new Error(`Index loader build failed with exit code ${result.code}`)
    }
    logger.log(`${colors.green('✓')} Built index loader`)

    // Compress CLI.
    logger.log(`${colors.blue('ℹ')} Compressing CLI...`)
    result = await spawn('node', ['scripts/compress-cli.mjs'], {
      shell: WIN32,
      stdio: 'inherit',
      cwd: rootPath,
    })
    if (result.code !== 0) {
      throw new Error(`CLI compression failed with exit code ${result.code}`)
    }
    logger.log(`${colors.green('✓')} Compressed CLI`)

    // Copy data directory from packages/cli.
    logger.log(`${colors.blue('ℹ')} Copying data/ from packages/cli...`)
    await fs.cp(path.join(cliPath, 'data'), path.join(rootPath, 'data'), {
      recursive: true,
    })
    logger.log(`${colors.green('✓')} Copied data/`)

    // Copy images from repo root.
    logger.log(`${colors.blue('ℹ')} Copying images from repo root...`)
    const images = ['logo-dark.png', 'logo-light.png']
    for (const image of images) {
      await fs.cp(path.join(repoRoot, image), path.join(rootPath, image))
    }
    logger.log(`${colors.green('✓')} Copied images`)
  } catch (error) {
    logger.error(`Build failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
