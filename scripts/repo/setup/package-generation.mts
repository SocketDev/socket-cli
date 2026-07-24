/**
 * @file Template-driven package generation helpers shared by
 *   scripts/setup.mts. Split out of setup.mts to keep each module under the
 *   fleet file-size cap.
 */

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

export interface PackageGenerationOptions {
  quiet: boolean
}

/**
 * Generate cli-with-sentry package from template.
 */
export async function generateCliSentryPackage({
  quiet,
}: PackageGenerationOptions): Promise<boolean> {
  if (!quiet) {
    logger.log('Generating cli-with-sentry package from template…')
  }

  // fileURLToPath, not URL.pathname: pathname yields `/D:/...` on Windows,
  // which node cannot load as a filesystem path.
  const scriptPath = fileURLToPath(
    new URL(
      '../../../packages/package-builder/scripts/generate-cli-sentry-package.mts',
      import.meta.url,
    ),
  )
  const result = await spawn('node', [scriptPath], {
    stdio: quiet ? 'pipe' : 'inherit',
  })

  if (result.code === 0) {
    if (!quiet) {
      logger.log('cli-with-sentry package generated!')
    }
    return true
  }

  logger.warn('Failed to generate cli-with-sentry package')
  return false
}

/**
 * Generate `@socketsecurity/cli.exe.<triplet>` tail packages from template.
 */
export async function generateCliExePackages({
  quiet,
}: PackageGenerationOptions): Promise<boolean> {
  if (!quiet) {
    logger.log('Generating cli.exe tail packages from template…')
  }

  // fileURLToPath, not URL.pathname — see generateCliSentryPackage above.
  const scriptPath = fileURLToPath(
    new URL(
      '../../../packages/package-builder/scripts/generate-cli-exe-packages.mts',
      import.meta.url,
    ),
  )
  const result = await spawn('node', [scriptPath], {
    stdio: quiet ? 'pipe' : 'inherit',
  })

  if (result.code === 0) {
    if (!quiet) {
      logger.log('cli.exe tail packages generated!')
    }
    return true
  }

  logger.warn('Failed to generate cli.exe tail packages')
  return false
}

/**
 * Generate socketbin packages from template.
 */
export async function generateSocketbinPackages({
  quiet,
}: PackageGenerationOptions): Promise<boolean> {
  if (!quiet) {
    logger.log('Generating socketbin packages from template…')
  }

  // fileURLToPath, not URL.pathname — see generateCliSentryPackage above.
  const scriptPath = fileURLToPath(
    new URL(
      '../../../packages/package-builder/scripts/generate-socketbin-packages.mts',
      import.meta.url,
    ),
  )
  const result = await spawn('node', [scriptPath], {
    stdio: quiet ? 'pipe' : 'inherit',
  })

  if (result.code === 0) {
    if (!quiet) {
      logger.log('Socketbin packages generated!')
    }
    return true
  }

  logger.warn('Failed to generate socketbin packages')
  return false
}
