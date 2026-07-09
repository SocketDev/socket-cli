/**
 * @file Template-driven package generation helpers shared by
 *   scripts/setup.mts. Split out of setup.mts to keep each module under the
 *   fleet file-size cap.
 */

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

  const scriptPath = new URL(
    '../../packages/package-builder/scripts/generate-cli-sentry-package.mts',
    import.meta.url,
  )
  const result = await spawn('node', [scriptPath.pathname], {
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
 * Generate socketbin packages from template.
 */
export async function generateSocketbinPackages({
  quiet,
}: PackageGenerationOptions): Promise<boolean> {
  if (!quiet) {
    logger.log('Generating socketbin packages from template…')
  }

  const scriptPath = new URL(
    '../../packages/package-builder/scripts/generate-socketbin-packages.mts',
    import.meta.url,
  )
  const result = await spawn('node', [scriptPath.pathname], {
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
