#!/usr/bin/env node
/**
 * Postinstall script for Socket CLI binary distribution.
 * Downloads the appropriate platform-specific binary from GitHub releases.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const zlib = require('node:zlib')

const GITHUB_REPO = 'SocketDev/socket-cli'
const BINARY_NAME = 'socket'

// Map Node.js platform/arch to our binary names.
const PLATFORM_MAP = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'win',
}

const ARCH_MAP = {
  arm64: 'arm64',
  x64: 'x64',
}

/**
 * Get the binary name for the current platform.
 */
function getBinaryName() {
  const platform = PLATFORM_MAP[os.platform()]
  const arch = ARCH_MAP[os.arch()]

  if (!platform || !arch) {
    throw new Error(`Unsupported platform: ${os.platform()} ${os.arch()}`)
  }

  const extension = os.platform() === 'win32' ? '.exe' : ''
  return `socket-${platform}-${arch}${extension}`
}

/**
 * Download a file from a URL.
 */
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    https
      .get(url, { headers: { 'User-Agent': 'socket-cli' } }, response => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect.
          file.close()
          downloadFile(response.headers.location, destPath).then(
            resolve,
            reject,
          )
          return
        }

        if (response.statusCode !== 200) {
          file.close()
          fs.unlinkSync(destPath)
          reject(new Error(`Failed to download: ${response.statusCode}`))
          return
        }

        response.pipe(file)
        file.on('finish', () => {
          file.close(resolve)
        })
      })
      .on('error', err => {
        file.close()
        fs.unlinkSync(destPath)
        reject(err)
      })
  })
}

/**
 * Get the download URL for the binary.
 */
async function getBinaryUrl() {
  const version = require('./package.json').version
  const binaryName = getBinaryName()

  // First try the tagged release.
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${binaryName}`
}

/**
 * Install the binary.
 */
async function install() {
  try {
    const binaryName = getBinaryName()
    const binaryPath = path.join(
      __dirname,
      BINARY_NAME + (os.platform() === 'win32' ? '.exe' : ''),
    )

    // Check if binary already exists.
    if (fs.existsSync(binaryPath)) {
      console.log('Socket CLI binary already installed.')
      return
    }

    console.log(`Downloading Socket CLI for ${os.platform()}-${os.arch()}...`)

    const url = await getBinaryUrl()
    const tempPath = binaryPath + '.download'

    // Download the binary.
    await downloadFile(url, tempPath)

    // Make executable on Unix.
    if (os.platform() !== 'win32') {
      fs.chmodSync(tempPath, 0o755)
    }

    // Move to final location.
    fs.renameSync(tempPath, binaryPath)

    console.log('Socket CLI installed successfully!')
  } catch (error) {
    console.error('Failed to install Socket CLI binary:', error.message)
    console.error(
      'You may need to install from source: npm install @socketsecurity/cli',
    )
    // Don't fail the install - allow fallback to source install.
  }
}

// Only run if this is the main module.
if (require.main === module) {
  install()
}
