/* eslint-disable no-console */
const { realpathSync } = require('fs')
const path = require('path')

const which = require('which')

/**
 * @param {string} realDirname path to shadow/bin
 * @param {'npm' | 'npx'} binname
 * @returns {string} path to npm provided cli / npx bin
 */
function installLinks (realDirname, binname) {
  const realNpmShadowBinDir = realDirname
  // find npm being shadowed by this process
  const npms = which.sync(binname, {
    all: true
  })
  let shadowIndex = -1
  const npmpath = npms.find((npmPath, i) => {
    const isShadow = realpathSync(path.dirname(npmPath)) === realNpmShadowBinDir
    if (isShadow) {
      shadowIndex = i
    }
    return !isShadow
  })
  if (npmpath && process.platform === 'win32') {
    return npmpath
  }
  if (!npmpath) {
    console.error('Socket unable to locate npm ensure it is available in the PATH environment variable')
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
