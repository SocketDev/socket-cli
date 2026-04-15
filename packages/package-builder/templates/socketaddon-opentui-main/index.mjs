/**
 * @socketaddon/opentui - Node.js bindings for OpenTUI terminal UI library
 *
 * Platform detection, native addon loading, and high-level render engine.
 * Automatically loads the correct .node binary for the current platform
 * and provides iocraft-compatible renderToString/printComponent/eprintComponent API.
 */

import { createRequire } from 'node:module'
import { platform, arch } from 'node:os'

const require = createRequire(import.meta.url)

/**
 * Detect the current platform and architecture.
 * @returns {string} Platform identifier (e.g., 'darwin-arm64', 'linux-x64-musl')
 */
function getPlatformIdentifier() {
  const platformName = platform()
  const archName = arch()

  const platformMap = {
    __proto__: null,
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win',
  }

  const archMap = {
    __proto__: null,
    arm64: 'arm64',
    x64: 'x64',
  }

  const mappedPlatform = platformMap[platformName]
  const mappedArch = archMap[archName]

  if (!mappedPlatform || !mappedArch) {
    throw new Error(
      `Unsupported platform: ${platformName} ${archName}\n` +
        `opentui native bindings are only available for:\n` +
        `  - macOS (darwin): arm64, x64\n` +
        `  - Linux (linux): arm64, x64 (glibc and musl)\n` +
        `  - Windows (win32): arm64, x64`,
    )
  }

  // Detect musl on Linux.
  let libcSuffix = ''
  if (platformName === 'linux') {
    try {
      const { spawnSync } = require('node:child_process')
      const lddResult = spawnSync('ldd', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const output = lddResult.stdout || ''
      if (output.includes('musl')) {
        libcSuffix = '-musl'
      }
    } catch {
      // If ldd fails, assume glibc.
    }
  }

  return `${mappedPlatform}-${mappedArch}${libcSuffix}`
}

/**
 * Load the native addon for the current platform.
 * @returns {object} The loaded opentui native module
 */
function loadNativeAddon() {
  const platformId = getPlatformIdentifier()
  const packageName = `@socketaddon/opentui-${platformId}`

  try {
    // Try to load from optionalDependencies first.
    return require(packageName)
  } catch (e) {
    // Fallback for development: resolve based on actual package location.
    try {
      const { dirname, join } = require('node:path')
      const { fileURLToPath } = require('node:url')
      const { realpathSync, existsSync } = require('node:fs')

      const __dirname = dirname(fileURLToPath(import.meta.url))
      const realDir = realpathSync(__dirname)

      let buildOutDir

      if (realDir.includes('/build/') && realDir.includes('/out/socketaddon-opentui')) {
        buildOutDir = realDir.split('/socketaddon-opentui')[0]
      } else if (realDir.includes('@socketaddon+opentui@file+packages+package-builder+build+dev+out+socketaddon-opentui')) {
        const match = realDir.match(/^(.+?)\/node_modules\/\.pnpm\/@socketaddon/)
        if (match) {
          const projectRoot = match[1]
          buildOutDir = join(projectRoot, 'packages/package-builder/build/dev/out')
        }
      }

      if (buildOutDir) {
        const siblingPath = join(buildOutDir, `socketaddon-opentui-${platformId}`, 'opentui.node')
        if (existsSync(siblingPath)) {
          return require(siblingPath)
        }
      }

      throw new Error('Not in development build structure')
    } catch {
      if (e.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          `Failed to load opentui native addon for ${platformId}.\n` +
            `The package ${packageName} is not installed.\n` +
            `This usually means your platform is not supported or the optionalDependencies were not installed correctly.\n\n` +
            `Try reinstalling with: npm install --force @socketaddon/opentui`,
        )
      }
      throw e
    }
  }
}

// Load native addon and create render engine.
const native = loadNativeAddon()
const { createRenderEngine } = require('./render-engine.mjs')
const engine = createRenderEngine(native)

export default engine
