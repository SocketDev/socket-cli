/**
 * @fileoverview Build script for Socket CLI with Sentry.
 * Delegates to esbuild config for actual build.
 * Copies data/ and images from packages/cli.
 */

import { cpSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const repoRoot = path.join(__dirname, '../../..')

/**
 * Runs a command and returns a promise.
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    })

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code})`),
        )
      }
    })
  })
}

async function main() {
  try {
    const esbuildConfig = path.join(
      rootPath,
      '.config/esbuild.cli-sentry.build.mjs',
    )
    const cliPath = path.join(rootPath, '..', 'cli')

    // Run esbuild config directly.
    await runCommand('node', [esbuildConfig], {
      cwd: rootPath,
      env: {
        ...process.env,
        INLINED_SOCKET_CLI_SENTRY_BUILD: '1',
      },
    })

    // Copy data directory from packages/cli.
    logger.log(`${colors.blue('ℹ')} Copying data/ from packages/cli...`)
    cpSync(path.join(cliPath, 'data'), path.join(rootPath, 'data'), {
      recursive: true,
    })
    logger.log(`${colors.green('✓')} Copied data/`)

    // Copy images from repo root.
    logger.log(`${colors.blue('ℹ')} Copying images from repo root...`)
    const images = ['logo-dark.png', 'logo-light.png']
    for (const image of images) {
      cpSync(path.join(repoRoot, image), path.join(rootPath, image))
    }
    logger.log(`${colors.green('✓')} Copied images`)
  } catch (error) {
    logger.error(`Build failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
