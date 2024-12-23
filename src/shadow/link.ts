import path from 'node:path'

import cmdShim from 'cmd-shim'

import constants from '../constants'
import { findBinPathDetails } from '../utils/path-resolve'

const { WIN32, rootDistPath } = constants

export async function installLinks(
  realBinPath: string,
  binName: 'npm' | 'npx'
): Promise<string> {
  // Find package manager being shadowed by this process.
  const { path: binPath, shadowed } = await findBinPathDetails(binName)
  if (!binPath) {
    // The exit code 127 indicates that the command or binary being executed
    // could not be found.
    console.error(
      `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable.`
    )
    process.exit(127)
  }
  // TODO: Is this early exit needed?
  if (WIN32 && binPath) {
    return binPath
  }
  // Move our bin directory to front of PATH so its found first.
  if (!shadowed) {
    if (WIN32) {
      await cmdShim(
        path.join(rootDistPath, `${binName}-cli.js`),
        path.join(realBinPath, binName)
      )
    }
    process.env['PATH'] =
      `${realBinPath}${path.delimiter}${process.env['PATH']}`
  }
  return binPath
}
