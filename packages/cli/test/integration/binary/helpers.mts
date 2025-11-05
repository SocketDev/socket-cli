/** @fileoverview Shared helpers for binary integration tests. */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { confirm } from '@socketsecurity/lib/stdio/prompts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT_DIR = path.resolve(__dirname, '../../..')
export const MONOREPO_ROOT = path.resolve(ROOT_DIR, '../..')

export const logger = getDefaultLogger()

export interface BinaryConfig {
  name: string
  path: string
  buildCommand: string[] | null
  enabled: boolean
}

/**
 * Build a binary if needed.
 */
export async function buildBinary(
  binary: BinaryConfig,
  binaryType: string,
): Promise<boolean> {
  if (!binary.buildCommand) {
    return false
  }

  logger.log(`Building ${binary.name}...`)
  logger.log(`Running: ${binary.buildCommand.join(' ')}`)

  if (binaryType === 'smol') {
    logger.log('Note: smol build may take 30-60 minutes on first build')
    logger.log('      (subsequent builds are faster with caching)')
  }
  logger.log('')

  try {
    const result = await spawn(
      binary.buildCommand[0],
      binary.buildCommand.slice(1),
      {
        cwd: MONOREPO_ROOT,
        stdio: 'inherit',
      },
    )

    if (result.code !== 0) {
      logger.error(`Failed to build ${binary.name}`)
      return false
    }

    logger.log(`Successfully built ${binary.name}`)
    return true
  } catch (e) {
    logger.error(`Error building ${binary.name}:`, e)
    return false
  }
}

/**
 * Check and prepare binary for testing.
 */
export async function prepareBinary(
  binary: BinaryConfig,
  binaryType: string,
): Promise<boolean> {
  // Log which binary we're testing.
  logger.log('')
  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  logger.log(`Testing: ${binary.name}`)
  logger.log(`Path: ${binary.path}`)
  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  // Check if binary exists.
  let binaryExists = existsSync(binary.path)
  logger.log(`Binary exists: ${binaryExists}`)

  if (!binaryExists) {
    logger.log('')
    logger.warn(`Binary not found: ${binary.path}`)

    // In CI: Skip building (rely on cache).
    if (process.env.CI) {
      logger.log('Running in CI - skipping build (binary not in cache)')
      if (binaryType === 'sea') {
        logger.log('To build SEA binaries, run: gh workflow run build-sea.yml')
      } else if (binaryType === 'smol') {
        logger.log(
          'To build smol binaries, run: gh workflow run build-smol.yml',
        )
      }
      logger.log('')
      return false
    }

    // Locally: Prompt user to build.
    const timeWarning = binaryType === 'smol' ? ' (may take 30-60 min)' : ''
    const shouldBuild = await confirm({
      default: true,
      message: `Build ${binary.name}?${timeWarning}`,
    })

    if (!shouldBuild) {
      logger.log('Skipping build. Tests will be skipped.')
      logger.log(
        `To build manually, run: ${binary.buildCommand?.join(' ') ?? 'N/A'}`,
      )
      logger.log('')
      return false
    }

    logger.log('Building binary...')
    const buildSuccess = await buildBinary(binary, binaryType)

    if (buildSuccess) {
      binaryExists = existsSync(binary.path)
    }

    if (!binaryExists) {
      logger.log('')
      logger.error(`Failed to build ${binary.name}. Tests will be skipped.`)
      logger.log('To build this binary manually, run:')
      logger.log(`  ${binary.buildCommand?.join(' ') ?? 'N/A'}`)
      logger.log('')
      return false
    }

    logger.log(`Binary built successfully: ${binary.path}`)
    logger.log('')
  } else {
    // Binary already exists.
    logger.log('')
    logger.log(`✓ Binary found and ready for testing`)
    logger.log('')
  }

  return true
}
