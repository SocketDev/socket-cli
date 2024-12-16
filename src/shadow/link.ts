import { realpathSync } from 'node:fs'
import path from 'node:path'

import cmdShim from 'cmd-shim'
import which from 'which'

import constants from '../constants'

const { WIN32, rootDistPath } = constants

export async function installLinks(
  realBinPath: string,
  binName: 'npm' | 'npx'
): Promise<string> {
  // Find package manager being shadowed by this process.
  const bins = await which(binName, {
    all: true
  })
  let shadowIndex = -1
  const binPath = bins.find((binPath, i) => {
    // Skip our bin directory if it's in the front.
    if (realpathSync(path.dirname(binPath)) === realBinPath) {
      shadowIndex = i
      return false
    }
    return true
  })
  if (!binPath) {
    console.error(
      `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`
    )
    // The exit code 127 indicates that the command or binary being executed
    // could not be found.
    process.exit(127)
  }
  // TODO: Is this early exit needed?
  if (WIN32 && binPath) {
    return binPath
  }
  // Move our bin directory to front of PATH so its found first.
  if (shadowIndex === -1) {
    if (WIN32) {
      await cmdShim(
        path.join(rootDistPath, `${binName}-cli.js`),
        path.join(realBinPath, binName)
      )
    }
    process.env['PATH'] =
      `${realBinPath}${WIN32 ? ';' : ':'}${process.env['PATH']}`
  }
  return binPath
}
