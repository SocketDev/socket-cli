/**
 * @file Build execution utilities Centralized command execution for build
 *   script.
 */

import type { SpawnStdioResult } from '@socketsecurity/lib-stable/process/spawn/types'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { saveBuildLog } from './build-helpers.mts'

const logger = getDefaultLogger()

interface ExecOptions {
  buildDir?: string | undefined
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
}

interface ExecSilentResult {
  code: number
  stdout: string
  stderr: string
}

interface DownloadOptions {
  buildDir?: string | undefined
  maxRetries?: number | undefined
  verifyIntegrity?: boolean | undefined
}

/**
 * Download file with retry and verification.
 */
async function downloadWithRetry(
  url: string,
  outputPath: string,
  options: DownloadOptions = {},
): Promise<boolean> {
  const { buildDir, maxRetries = 3, verifyIntegrity = true } = options

  // Import verifyFileIntegrity dynamically to avoid circular dependency.
  const { verifyFileIntegrity } = await import('./build-helpers.mts')

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
      const message = errorMessage(e)
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
      logger.log(`  ⏱️  Waiting ${waitTime}ms before retry…`)
      await new Promise<void>(resolve => setTimeout(resolve, waitTime))
    }
  }

  return false
}

/**
 * Execute a command and stream output.
 */
export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<SpawnStdioResult> {
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- helper accepts cwd; the process.cwd() default is for ad-hoc invocations, not a bypass of the anchor-on-script-location rule.
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
async function execSilent(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecSilentResult> {
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- helper accepts cwd; the process.cwd() default is for ad-hoc invocations, not a bypass of the anchor-on-script-location rule.
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
