import path from 'node:path'

import cmdShim from 'cmd-shim'

import constants from '../../constants.mts'
import {
  getNpmBinPath,
  getNpxBinPath,
  isNpmBinPathShadowed,
  isNpxBinPathShadowed,
} from '../../utils/npm-paths.mts'

export async function installLinks(
  realBinPath: string,
  binName: 'npm' | 'npx',
): Promise<string> {
  const isNpx = binName === 'npx'
  // Find package manager being shadowed by this process.
  const binPath = isNpx ? getNpxBinPath() : getNpmBinPath()
  // Lazily access constants.WIN32.
  const { WIN32 } = constants
  // TODO: Is this early exit needed?
  if (WIN32 && binPath) {
    return binPath
  }
  const shadowed = isNpx ? isNpxBinPathShadowed() : isNpmBinPathShadowed()
  // Move our bin directory to front of PATH so its found first.
  if (!shadowed) {
    if (WIN32) {
      await cmdShim(
        // Lazily access constants.distPath.
        path.join(constants.distPath, `${binName}-cli.js`),
        path.join(realBinPath, binName),
      )
    }
    const { env } = process
    env['PATH'] = `${realBinPath}${path.delimiter}${env['PATH']}`
  }
  return binPath
}
