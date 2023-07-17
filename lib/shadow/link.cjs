/* eslint-disable no-console */
const { realpathSync } = require('fs')
const path = require('path')

const which = require('which')

if (process.platform === 'win32') {
  console.error('Socket dependency manager Windows suppport is limited to WSL at this time.')
  process.exit(1)
}

/**
 * @param {string} realDirname path to shadow/bin
 * @param {'npm' | 'npx'} binname
 * @returns {string} path to original bin
 */
function installLinks (realDirname, binname) {
  const realShadowBinDir = realDirname
  // find package manager being shadowed by this process
  const bins = which.sync(binname, {
    all: true
  })
  let shadowIndex = -1
  const binpath = bins.find((binPath, i) => {
    const isShadow = realpathSync(path.dirname(binPath)) === realShadowBinDir
    if (isShadow) {
      shadowIndex = i
    }
    return !isShadow
  })
  if (binpath && process.platform === 'win32') {
    return binpath
  }
  if (!binpath) {
    console.error(`Socket unable to locate ${binname}; ensure it is available in the PATH environment variable`)
    process.exit(127)
  }
  if (shadowIndex === -1) {
    const bindir = path.join(realDirname)
    process.env['PATH'] = `${
      bindir
    }${
      process.platform === 'win32' ? ';' : ':'
    }${
      process.env['PATH']
    }`
  }
  return npmpath
}
module.exports = installLinks
