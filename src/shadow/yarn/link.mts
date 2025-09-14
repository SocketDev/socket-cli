import path from 'node:path'

import cmdShim from 'cmd-shim'

import constants from '../../constants.mts'
import {
  getYarnBinPath,
  isYarnBinPathShadowed,
} from '../../utils/yarn-paths.mts'

export async function installLinks(
  shadowBinPath: string,
  binName: 'yarn',
): Promise<string> {
  const binPath = getYarnBinPath()
  const { WIN32 } = constants

  if (WIN32 && binPath) {
    return binPath
  }

  const shadowed = isYarnBinPathShadowed()

  if (!shadowed) {
    if (WIN32) {
      await cmdShim(
        path.join(constants.distPath, `${binName}-cli.js`),
        path.join(shadowBinPath, binName),
      )
    }
    const { env } = process
    env['PATH'] = `${shadowBinPath}${path.delimiter}${env['PATH']}`
  }

  return binPath
}
