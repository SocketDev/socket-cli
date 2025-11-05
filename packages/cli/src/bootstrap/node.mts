#!/usr/bin/env node
/**
 * Node.js Internal Bootstrap
 *
 * This file is loaded by the custom Node.js binary at startup via
 * internal/bootstrap/socketsecurity module.
 *
 * Responsibilities:
 * - Check if @socketsecurity/cli is installed in ~/.socket/_dlx/cli/
 * - If not installed: download and extract from npm
 * - Spawn the CLI with current arguments
 *
 * Size target: <2KB after minification + brotli compression
 * Build output: dist/bootstrap/node.js (copied to Node.js source)
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getNodeDisableSigusr1Flags } from './shared/node-flags.mjs'
import {
  getCliEntryPoint,
  getCliPackageDir,
  getCliPackageName,
  getDlxDir,
} from './shared/paths.mjs'

const logger = getDefaultLogger()

/**
 * Check if CLI is installed.
 */
function isCliInstalled(): boolean {
  const entryPoint = getCliEntryPoint()
  const packageJson = `${getCliPackageDir()}/package.json`
  return existsSync(entryPoint) && existsSync(packageJson)
}

/**
 * Download CLI using npm pack command.
 * This delegates to npm which handles downloading and extracting the latest version.
 */
async function downloadCli(): Promise<void> {
  const packageName = getCliPackageName()
  const dlxDir = getDlxDir()
  const cliDir = getCliPackageDir()

  await safeMkdir(dlxDir, { recursive: true })

  logger.error(`Downloading ${packageName}...`)

  return new Promise((resolve, reject) => {
    const npmPackProcess = spawn(
      'npm',
      ['pack', packageName, '--pack-destination', dlxDir],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )

    let tarballName = ''
    npmPackProcess.stdout?.on('data', data => {
      tarballName += data.toString()
    })

    npmPackProcess.on('error', e => {
      reject(new Error(`Failed to run npm pack: ${e}`))
    })

    npmPackProcess.on('exit', async code => {
      if (code !== 0) {
        reject(new Error(`npm pack exited with code ${code}`))
        return
      }

      try {
        const tarballPath = path.join(dlxDir, tarballName.trim())

        await safeMkdir(cliDir, { recursive: true })

        const tarExtractProcess = spawn(
          'tar',
          ['-xzf', tarballPath, '-C', cliDir, '--strip-components=1'],
          {
            stdio: 'inherit',
          },
        )

        tarExtractProcess.on('error', e => {
          reject(new Error(`Failed to extract tarball: ${e}`))
        })

        tarExtractProcess.on('exit', async extractCode => {
          if (extractCode !== 0) {
            reject(new Error(`tar extraction exited with code ${extractCode}`))
            return
          }

          await fs.unlink(tarballPath).catch(() => {
            // Ignore cleanup errors.
          })

          logger.error('Socket CLI installed successfully')
          resolve()
        })
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Check if CLI is already installed.
  if (!isCliInstalled()) {
    logger.error('Socket CLI not installed yet.')
    try {
      await downloadCli()
    } catch (error) {
      logger.error('Failed to download Socket CLI:', error)
      // eslint-disable-next-line n/no-process-exit
      process.exit(1)
    }
  }

  // CLI is installed, delegate to it.
  const cliPath = getCliEntryPoint()
  const args = process.argv.slice(2)

  const child = spawn(
    process.execPath,
    [...getNodeDisableSigusr1Flags(), cliPath, ...args],
    {
      stdio: 'inherit',
      env: process.env,
    },
  )

  child.on('error', error => {
    logger.error('Failed to spawn CLI:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    // eslint-disable-next-line n/no-process-exit
    process.exit(code ?? (signal ? 1 : 0))
  })
}

// Only run if executed directly (not when loaded as module).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Bootstrap error:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}
