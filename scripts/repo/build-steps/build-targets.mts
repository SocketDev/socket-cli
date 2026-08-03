/**
 * @file Single-package and single-platform build primitives shared by
 *   scripts/build.mts. Split out of scripts/build.mts to keep each module
 *   under the fleet file-size cap.
 */

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import colors from 'yoctocolors-cjs'

import {
  formatPlatformTarget,
  parsePlatformTarget,
} from '../../../packages/build-infra/lib/platform-targets.mts'
import {
  computeBuildSignature,
  needsBuild,
  writeSignature,
} from './build-signature.mts'
import type {
  BuildPackageConfig,
  BuildResult,
  BuildTargetResult,
} from './config.mts'
import { TARGET_PACKAGES } from './config.mts'
import { logger } from './context.mts'

/**
 * Build SEA binary for current platform.
 */
export async function buildCurrentPlatformSea(): Promise<{ success: boolean }> {
  const { arch, platform } = await import('node:os')
  const currentPlatform = platform()
  const currentArch = arch()

  logger.log('')
  logger.log(
    `${colors.cyan('→')} Building SEA binary for ${currentPlatform}-${currentArch}...`,
  )

  const startTime = Date.now()
  const result = await spawn(
    'pnpm',
    [
      '--filter',
      '@socketsecurity/cli',
      'run',
      'build:sea',
      `--platform=${currentPlatform}`,
      `--arch=${currentArch}`,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(`${colors.red('✗')} SEA build failed (${duration}s)`)
    return { success: false }
  }

  logger.log(`${colors.green('✓')} SEA binary built (${duration}s)`)
  return { success: true }
}

/**
 * Build a single package.
 */
export async function buildPackage(
  pkg: BuildPackageConfig,
  config: { force: boolean },
): Promise<BuildResult> {
  const { force } = { __proto__: null, ...config } as typeof config
  const skip = !needsBuild(pkg, { force })

  if (skip) {
    logger.log(
      `${colors.cyan('→')} ${pkg.name}: ${colors.gray('skipped (up to date)')}`,
    )
    return { success: true, skipped: true }
  }

  logger.log(`${colors.cyan('→')} ${pkg.name}: ${colors.blue('building…')}`)

  const buildScript = force ? 'build:force' : 'build'
  const args = ['--filter', pkg.filter, 'run', buildScript]

  const startTime = Date.now()
  const result = await spawn('pnpm', args, {
    shell: WIN32,
    stdio: 'inherit',
  })
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(
      `${colors.red('✗')} ${pkg.name}: ${colors.red('failed')} (${duration}s)`,
    )
    return { success: false, skipped: false }
  }

  logger.log(
    `${colors.green('✓')} ${pkg.name}: ${colors.green('built')} (${duration}s)`,
  )

  try {
    writeSignature(pkg, computeBuildSignature(pkg))
  } catch (e) {
    logger.warn(
      `Could not write build signature for ${pkg.name}: ${errorMessage(e)}`,
    )
  }

  return { success: true, skipped: false }
}

/**
 * Build SEA binary for a specific platform.
 */
export async function buildPlatformSea(
  platform: string,
  arch: string,
  libc: string | undefined,
): Promise<{ success: boolean }> {
  const targetName = formatPlatformTarget(platform, arch, libc)

  logger.log('')
  logger.log(`${colors.cyan('→')} Building SEA binary for ${targetName}...`)

  const seaArgs = [
    '--filter',
    '@socketsecurity/cli',
    'run',
    'build:sea',
    `--platform=${platform}`,
    `--arch=${arch}`,
  ]

  if (libc) {
    seaArgs.push(`--libc=${libc}`)
  }

  const startTime = Date.now()
  const result = await spawn('pnpm', seaArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(
      `${colors.red('✗')} SEA build for ${targetName} failed (${duration}s)`,
    )
    return { success: false }
  }

  logger.log(
    `${colors.green('✓')} SEA binary for ${targetName} built (${duration}s)`,
  )
  return { success: true }
}

/**
 * Build a single target (for parallel/sequential builds).
 */
export async function buildTarget(
  target: string,
  buildArgs: string[],
): Promise<BuildTargetResult> {
  const startTime = Date.now()
  logger.log(`${colors.cyan('→')} [${target}] Starting build…`)

  // Check if this is a platform target (e.g., darwin-arm64).
  const platformInfo = parsePlatformTarget(target)
  if (platformInfo) {
    const seaArgs = [
      '--filter',
      '@socketsecurity/cli',
      'run',
      'build:sea',
      `--platform=${platformInfo.platform}`,
      `--arch=${platformInfo.arch}`,
    ]

    if (platformInfo.libc) {
      seaArgs.push(`--libc=${platformInfo.libc}`)
    }

    const result = await spawn('pnpm', seaArgs, {
      shell: WIN32,
      stdio: 'pipe',
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    if (result.code === 0) {
      logger.log(
        `${colors.green('✓')} [${target}] Build succeeded (${duration}s)`,
      )
      return { duration, success: true, target }
    }

    logger.error(`${colors.red('✗')} [${target}] Build failed (${duration}s)`)
    if (result.stderr) {
      logger.error(`${colors.red('✗')} [${target}] Error output:`)
      logger.error(result.stderr)
    }
    return { duration, success: false, target }
  }

  // Not a platform target, use pnpm filter for package builds.
  const packageFilter = TARGET_PACKAGES[target]
  if (!packageFilter) {
    throw new Error(`Unknown build target: ${target}`)
  }

  const pnpmArgs = ['--filter', packageFilter, 'run', 'build', ...buildArgs]

  const result = await spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'pipe',
  })

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code === 0) {
    logger.log(
      `${colors.green('✓')} [${target}] Build succeeded (${duration}s)`,
    )
    return { duration, success: true, target }
  }

  logger.error(`${colors.red('✗')} [${target}] Build failed (${duration}s)`)
  if (result.stderr) {
    logger.error(`${colors.red('✗')} [${target}] Error output:`)
    logger.error(result.stderr)
  }
  return { duration, success: false, target }
}
