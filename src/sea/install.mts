/**
 * @fileoverview NPM postinstall script for Socket CLI binary distribution.
 * Downloads the appropriate platform-specific binary from GitHub releases.
 * This runs when users install the `socket` npm package.
 */

import { createWriteStream, existsSync } from 'node:fs'
import { chmod, rename, unlink } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Binary naming constants
const BINARY_NAME = 'socket'
const GITHUB_ORG = 'SocketDev'
const GITHUB_REPO = 'socket-cli'

// Map Node.js platform/arch to our binary naming convention
const PLATFORM_MAP: Record<string, string> = {
  // macOS
  darwin: 'darwin',
  linux: 'linux',
  // Windows
  win32: 'win32'
}

const ARCH_MAP: Record<string, string> = {
  arm64: 'arm64',
  x64: 'x64'
}

/**
 * Get the binary filename for the current platform.
 */
function getBinaryName(): string {
  const platform = PLATFORM_MAP[os.platform()]
  const arch = ARCH_MAP[os.arch()]

  if (!platform || !arch) {
    throw new Error(
      `Unsupported platform: ${os.platform()} ${os.arch()}. ` +
      `Please install @socketsecurity/cli directly instead.`
    )
  }

  const extension = os.platform() === 'win32' ? '.exe' : ''
  return `socket-${platform}-${arch}${extension}`
}

/**
 * Get package version from package.json.
 */
async function getPackageVersion(): Promise<string> {
  // In production, this will be in npm-package/package.json
  const packagePath = path.join(__dirname, '..', '..', 'npm-package', 'package.json')
  if (existsSync(packagePath)) {
    const { default: pkg } = await import(packagePath, { with: { type: 'json' } })
    return pkg.version
  }

  // Fallback for development
  const devPackagePath = path.join(__dirname, '..', '..', '..', 'package.json')
  const { default: pkg } = await import(devPackagePath, { with: { type: 'json' } })
  return pkg.version
}

/**
 * Download a file from a URL with redirect handling.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return await new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)

    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'socket-cli-installer'
        }
      },
      response => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (!redirectUrl) {
            file.close()
            unlink(destPath).catch(() => {})
            reject(new Error('Redirect without location header'))
            return
          }

          file.close()
          downloadFile(redirectUrl, destPath).then(resolve, reject)
          return
        }

        // Check for successful response
        if (response.statusCode !== 200) {
          file.close()
          unlink(destPath).catch(() => {})
          reject(new Error(
            `Failed to download binary: HTTP ${response.statusCode}`
          ))
          return
        }

        // Pipe response to file
        response.pipe(file)

        file.on('finish', () => {
          file.close(() => resolve())
        })
      }
    )

    request.on('error', err => {
      file.close()
      unlink(destPath).catch(() => {})
      reject(err)
    })
  })
}

/**
 * Get the download URL for the binary.
 */
async function getBinaryUrl(): Promise<string> {
  const version = await getPackageVersion()
  const binaryName = getBinaryName()

  // GitHub releases URL pattern
  return `https://github.com/${GITHUB_ORG}/${GITHUB_REPO}/releases/download/v${version}/${binaryName}`
}

/**
 * Install the platform-specific binary.
 */
async function install(): Promise<void> {
  try {
    const binaryName = getBinaryName()
    const targetName = BINARY_NAME + (os.platform() === 'win32' ? '.exe' : '')
    const binaryPath = path.join(__dirname, '..', '..', 'npm-package', targetName)

    // For development, use local path
    const devBinaryPath = path.join(__dirname, targetName)
    const finalPath = existsSync(path.dirname(binaryPath)) ? binaryPath : devBinaryPath

    // Check if binary already exists
    if (existsSync(finalPath)) {
      console.log('Socket CLI binary already installed.')
      return
    }

    console.log(`Downloading Socket CLI for ${os.platform()}-${os.arch()}...`)

    const url = await getBinaryUrl()
    const tempPath = `${finalPath}.download`

    // Download the binary
    await downloadFile(url, tempPath)

    // Make executable on Unix-like systems
    if (os.platform() !== 'win32') {
      await chmod(tempPath, 0o755)
    }

    // Atomic rename to final location
    await rename(tempPath, finalPath)

    console.log('✓ Socket CLI installed successfully!')
    console.log(`  Binary: ${finalPath}`)
    console.log(`  Run 'socket --help' to get started.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.error(`Failed to install Socket CLI binary: ${message}`)
    console.error('')
    console.error('You can try:')
    console.error('  1. Installing from source: npm install -g @socketsecurity/cli')
    console.error('  2. Downloading manually from: https://github.com/SocketDev/socket-cli/releases')
    console.error('')
    console.error('For help, visit: https://github.com/SocketDev/socket-cli/issues')

    // Don't fail the npm install - allow fallback to source
    process.exitCode = 0
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  install().catch(error => {
    console.error('Unexpected error:', error)
    // Still don't fail npm install
    process.exitCode = 0
  })
}

export { install, getBinaryName, getBinaryUrl }