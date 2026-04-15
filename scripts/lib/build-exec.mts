/**
 * @fileoverview Build execution utilities
 *
 * Centralized command execution for build script.
 */

import type { SpawnStdioResult } from '@socketsecurity/lib/spawn'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { saveBuildLog } from './build-helpers.mts'

const logger = getDefaultLogger()

interface ExecOptions {
  buildDir?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

interface ExecSilentResult {
  code: number
  stdout: string
  stderr: string
}

interface DownloadOptions {
  buildDir?: string
  maxRetries?: number
  verifyIntegrity?: boolean
}

/**
 * Execute a command and stream output.
 */
export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<SpawnStdioResult> {
  const { buildDir, cwd = process.cwd(), env = process.env } = options

  const cmdStr = `$ ${command} ${args.join(' ')}`
  logger.log(cmdStr)

  if (buildDir) {
    await saveBuildLog(buildDir, cmdStr)
  }

  const result = await spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.code !== 0) {
    throw new Error(
      `Command failed with exit code ${result.code}: ${command} ${args.join(' ')}`,
    )
  }

  return result
}

/**
 * Execute a command silently (no output).
 */
export async function execSilent(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecSilentResult> {
  const { cwd = process.cwd(), env = process.env } = options

  const result = await spawn(command, args, {
    cwd,
    env,
    stdio: 'pipe',
    shell: false,
  })

  return {
    code: result.code,
    stdout: result.stdout ? String(result.stdout).trim() : '',
    stderr: result.stderr ? String(result.stderr).trim() : '',
  }
}

/**
 * Download file with retry and verification.
 */
export async function downloadWithRetry(
  url: string,
  outputPath: string,
  options: DownloadOptions = {},
): Promise<boolean> {
  const { buildDir, maxRetries = 3, verifyIntegrity = true } = options

  // Import verifyFileIntegrity dynamically to avoid circular dependency.
  const { verifyFileIntegrity } = await import('./build-helpers.mjs')

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        logger.log(`  Retry attempt ${attempt}/${maxRetries}...`)
      }

      await exec('curl', ['-sL', url, '-o', outputPath], { buildDir })

      if (verifyIntegrity) {
        const integrity = await verifyFileIntegrity(outputPath)
        if (!integrity.valid) {
          throw new Error(`File integrity check failed: ${integrity.reason}`)
        }
      }

      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (attempt === maxRetries) {
        throw new Error(
          `Download failed after ${maxRetries} attempts: ${message}`,
        )
      }

      logger.warn(`  ⚠️  Download attempt ${attempt} failed: ${message}`)

      // Delete corrupted file if it exists.
      try {
        const { unlink } = await import('node:fs/promises')
        await unlink(outputPath)
      } catch {
        // Ignore errors.
      }

      // Wait before retry (exponential backoff).
      const waitTime = Math.min(1000 * 2 ** (attempt - 1), 5000)
      logger.log(`  ⏱️  Waiting ${waitTime}ms before retry...`)
      await new Promise<void>(resolve => setTimeout(resolve, waitTime))
    }
  }

  return false
}
