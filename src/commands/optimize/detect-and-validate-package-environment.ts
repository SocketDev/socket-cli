import path from 'node:path'

import constants from '../../constants'
import { detectPackageEnvironment } from '../../utils/package-environment-detector'

import type { PackageEnvironmentDetails } from '../../utils/package-environment-detector'
import type { Logger } from '@socketsecurity/registry/lib/logger'

const { BUN, VLT, YARN_BERRY } = constants

const COMMAND_TITLE = 'Socket Optimize'

export type DetectAndValidateOptions = {
  logger?: Logger | undefined
  prod?: boolean | undefined
}
export async function detectAndValidatePackageEnvironment(
  cwd: string,
  options?: DetectAndValidateOptions | undefined
): Promise<void | PackageEnvironmentDetails> {
  const { logger, prod } = <DetectAndValidateOptions>{
    __proto__: null,
    ...options
  }
  const details = await detectPackageEnvironment({
    cwd,
    onUnknown(pkgManager: string | undefined) {
      logger?.warn(
        `${COMMAND_TITLE}: Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to npm`
      )
    }
  })
  if (!details.supported) {
    logger?.fail(
      `${COMMAND_TITLE}: No supported Node or browser range detected`
    )
    return
  }
  if (details.agent === VLT) {
    logger?.fail(
      `${COMMAND_TITLE}: ${details.agent} does not support overrides. Soon, though ⚡`
    )
    return
  }
  const lockName = details.lockName ?? 'lock file'
  if (details.lockName === undefined || details.lockSrc === undefined) {
    logger?.fail(`${COMMAND_TITLE}: No ${lockName} found`)
    return
  }
  if (details.lockSrc.trim() === '') {
    logger?.fail(`${COMMAND_TITLE}: ${lockName} is empty`)
    return
  }
  if (details.pkgPath === undefined) {
    logger?.fail(`${COMMAND_TITLE}: No package.json found`)
    return
  }
  if (prod && (details.agent === BUN || details.agent === YARN_BERRY)) {
    logger?.fail(
      `${COMMAND_TITLE}: --prod not supported for ${details.agent}${details.agentVersion ? `@${details.agentVersion.toString()}` : ''}`
    )
    return
  }
  if (
    details.lockPath &&
    path.relative(cwd, details.lockPath).startsWith('.')
  ) {
    logger?.warn(
      `${COMMAND_TITLE}: Package ${lockName} found at ${details.lockPath}`
    )
  }
  return <PackageEnvironmentDetails>details
}
