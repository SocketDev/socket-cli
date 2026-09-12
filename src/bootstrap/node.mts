#!/usr/bin/env node
/**
 * Node.js Internal Bootstrap.
 *
 * This file is loaded by the custom Node.js binary at startup via
 * internal/bootstrap/socketsecurity module.
 *
 * Responsibilities:
 *
 * - Check if @socketsecurity/cli is installed in ~/.socket/_dlx/cli/
 * - If not installed: download and extract from npm
 * - Spawn the CLI with current arguments
 *
 * Size target: <2KB after minification + brotli compression Build output:
 * dist/bootstrap/node.js (copied to Node.js source)
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getNodeDisableSigusr1Flags } from './shared/node-flags.mjs'
import {
  getCliEntryPoint,
  getCliPackageDir,
  getCliPackageName,
  getDlxDir,
} from './shared/paths.mjs'
import {
  needsShellForBinPath,
  resolveSystemBinPath,
} from './shared/system-bin-paths.mjs'

const logger = getDefaultLogger()

/**
 * Download CLI using npm pack command. This delegates to npm which handles
 * downloading and extracting the latest version.
 */
export async function downloadCli(): Promise<void> {
  const packageName = getCliPackageName()
  const dlxDir = getDlxDir()
  const cliDir = getCliPackageDir()

  await safeMkdir(dlxDir, { recursive: true })

  logger.error(`Downloading ${packageName}...`)

  return new Promise((resolve, reject) => {
    const npmPath = resolveSystemBinPath('npm')
    if (!npmPath) {
      reject(
        new Error(
          `Cannot download ${packageName}: npm was not found in any trusted PATH directory (the working directory and node_modules/.bin are excluded). Install Node.js, which ships npm, or add npm's directory to PATH, then re-run.`,
        ),
      )
      return
    }

    const npmPackProcess = spawn(
      npmPath,
      ['pack', packageName, '--pack-destination', dlxDir],
      {
        shell: needsShellForBinPath(npmPath),
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )

    let tarballName = ''
    npmPackProcess.process.stdout?.on('data', (data: Buffer) => {
      tarballName += data.toString()
    })

    npmPackProcess.process.on('error', (e: Error) => {
      reject(new Error(`Failed to run npm pack: ${e}`))
    })

    npmPackProcess.process.on('exit', async (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`npm pack exited with code ${code}`))
        return
      }

      try {
        const tarballPath = path.join(dlxDir, tarballName.trim())

        await safeMkdir(cliDir, { recursive: true })

        const tarPath = resolveSystemBinPath('tar')
        if (!tarPath) {
          reject(
            new Error(
              `Cannot extract ${tarballPath}: tar was not found in any trusted PATH directory (the working directory and node_modules/.bin are excluded). Install tar, or add its directory to PATH, then re-run.`,
            ),
          )
          return
        }

        const tarExtractProcess = spawn(
          tarPath,
          ['-xzf', tarballPath, '-C', cliDir, '--strip-components=1'],
          {
            shell: needsShellForBinPath(tarPath),
            stdio: 'inherit',
          },
        )

        tarExtractProcess.process.on('error', (e: Error) => {
          reject(new Error(`Failed to extract tarball: ${e}`))
        })

        tarExtractProcess.process.on(
          'exit',
          async (extractCode: number | null) => {
            if (extractCode !== 0) {
              reject(
                new Error(`tar extraction exited with code ${extractCode}`),
              )
              return
            }

            await safeDelete(tarballPath, { force: true })

            logger.error('Socket CLI installed successfully')
            resolve()
          },
        )
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * Check if CLI is installed.
 */
export function isCliInstalled(): boolean {
  const entryPoint = getCliEntryPoint()
  const packageJson = `${getCliPackageDir()}/package.json`
  return existsSync(entryPoint) && existsSync(packageJson)
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
    } catch (e) {
      logger.error('Failed to download Socket CLI:', e)
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

  child.process.on('error', (error: Error) => {
    logger.error('Failed to spawn CLI:', error)
    process.exit(1)
  })

  child.process.on(
    'exit',
    (code: number | null, signal: NodeJS.Signals | null) => {
      process.exit(code ?? (signal ? 1 : 0))
    },
  )
}

// Only run if executed directly (not when loaded as module).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Bootstrap error:', error)
    process.exit(1)
  })
}
