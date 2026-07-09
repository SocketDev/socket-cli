/**
 * @file Build-cache restoration helper shared by scripts/setup.mts. Split out
 *   of setup.mts to keep each module under the fleet file-size cap.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

/**
 * Restore build cache if possible.
 */
export async function restoreCache(hasGh: boolean): Promise<boolean> {
  // Skip entirely if gh CLI not available.
  if (!hasGh) {
    logger.info('Skipping cache restoration (gh CLI not available)')
    return false
  }

  // Check if already built.
  if (existsSync('packages/cli/build') && existsSync('packages/cli/dist')) {
    logger.info('Build artifacts already exist, skipping cache restoration')
    return true
  }

  // Ensure directories exist.
  logger.log('Ensuring build directories exist…')
  await mkdir('packages/cli/build', { recursive: true })
  await mkdir('packages/cli/dist', { recursive: true })

  logger.log('Attempting to restore build cache from CI…')

  const result = await spawn(
    'pnpm',
    ['--filter', '@socketsecurity/cli', 'run', 'restore-cache', '--quiet'],
    {
      stdio: 'inherit',
    },
  )

  if (result.code === 0) {
    logger.log('Build cache restored!')
    return true
  }

  logger.info('Cache not available for this commit (will build from scratch)')
  return false
}
