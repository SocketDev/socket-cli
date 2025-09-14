import path from 'node:path'

import cmdShim from 'cmd-shim'

import constants from '../../constants.mts'
import {
  getPnpmBinPath,
  isPnpmBinPathShadowed,
} from '../../utils/pnpm-paths.mts'

export async function installLinks(
  shadowBinPath: string,
  _binName: 'pnpm',
): Promise<string> {
  // Find pnpm being shadowed by this process.
  const binPath = getPnpmBinPath()
  const { WIN32 } = constants

  // TODO: Is this early exit needed?
  if (WIN32 && binPath) {
    return binPath
  }

  const shadowed = isPnpmBinPathShadowed()

  // Move our bin directory to front of PATH so its found first.
  if (!shadowed) {
    if (WIN32) {
      await cmdShim(
        path.join(constants.distPath, 'pnpm-cli.js'),
        path.join(shadowBinPath, 'pnpm'),
      )
    }
    const { env } = process
    env['PATH'] = `${shadowBinPath}${path.delimiter}${env['PATH']}`
  }

  return binPath
}
