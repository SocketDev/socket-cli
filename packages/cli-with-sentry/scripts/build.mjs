/**
 * @fileoverview Build script for Socket CLI with Sentry.
 * Delegates to esbuild config for actual build.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

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

    // Run esbuild config directly.
    await runCommand('node', [esbuildConfig], {
      cwd: rootPath,
      env: {
        ...process.env,
        INLINED_SOCKET_CLI_SENTRY_BUILD: '1',
      },
    })
  } catch (error) {
    logger.error(`Build failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
