import path from 'node:path'
import process from 'node:process'

import cmdShim from 'cmd-shim'

import {
  getNpmBinPath,
  getNpxBinPath,
  isNpmBinPathShadowed,
  isNpxBinPathShadowed
} from './paths'
import constants from '../../constants'

const { CLI, NPX } = constants

export async function installLinks(
  realBinPath: string,
  binName: 'npm' | 'npx'
): Promise<string> {
  const isNpx = binName === NPX
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
        // Lazily access constants.rootDistPath.
        path.join(constants.rootDistPath, `${binName}-${CLI}.js`),
        path.join(realBinPath, binName)
      )
    }
    const { env } = process
    env['PATH'] = `${realBinPath}${path.delimiter}${env['PATH']}`
  }
  return binPath
}
