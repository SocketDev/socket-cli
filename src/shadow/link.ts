import { realpathSync } from 'node:fs'
import path from 'node:path'

import which from 'which'

export function installLinks(
  realDirname: string,
  binName: 'npm' | 'npx'
): string {
  const realShadowBinDir = realDirname
  // find package manager being shadowed by this process
  const bins = which.sync(binName, {
    all: true
  })
  let shadowIndex = -1
  const binPath = bins.find((binPath, i) => {
    if (realpathSync(path.dirname(binPath)) === realShadowBinDir) {
      shadowIndex = i
      return false
    }
    return true
  })
  const isWin = process.platform === 'win32'
  if (isWin && binPath) {
    return binPath
  }
  if (!binPath) {
    console.error(
      `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`
    )
    process.exit(127)
  }
  if (shadowIndex === -1) {
    const binDir = path.join(realDirname)
    process.env['PATH'] = `${binDir}${isWin ? ';' : ':'}${process.env['PATH']}`
  }
  return binPath
}
