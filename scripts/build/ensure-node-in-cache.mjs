#!/usr/bin/env node

/**
 * @fileoverview Ensure custom Node binary is in pkg cache
 *
 * This module checks if a custom Node binary exists in the pkg cache
 * and copies it there if needed.
 */

import { existsSync } from 'node:fs'
import { mkdir, copyFile } from 'node:fs/promises'
import { homedir, platform as osPlatform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Use os.homedir() for better cross-platform support
const PKG_CACHE_DIR = join(homedir(), '.pkg-cache', 'v3.5')

/**
 * Ensure custom Node binary is in pkg cache
 *
 * This function looks for the custom Node.js binary built by build-tiny-node.mjs
 * and copies it to pkg's cache directory if not already there.
 *
 * @param {string} nodeVersion - Node version (e.g., 'v24.9.0')
 * @param {string} platform - Platform ('darwin', 'linux', 'win32')
 * @param {string} arch - Architecture ('x64', 'arm64')
 * @returns {string} Path to the cached binary
 */
export default async function ensureCustomNodeInCache(nodeVersion = 'v24.9.0', platform = process.platform, arch = process.arch) {
  const platformName = platform === 'darwin' ? 'macos' : platform
  const cacheName = `built-${nodeVersion}-${platformName}-${arch}`
  const cachePath = join(PKG_CACHE_DIR, cacheName)

  // Check if already in cache
  if (existsSync(cachePath)) {
    console.log(`✅ Custom Node binary found in cache: ${cacheName}`)
    return cachePath
  }

  // Look for custom build binary in various locations
  // Properly convert file URL to path (cross-platform)
  const __filename = fileURLToPath(import.meta.url)
  const rootDir = join(__filename, '..', '..', '..')

  // Add .exe extension on Windows
  const nodeBinary = platform === 'win32' ? 'node.exe' : 'node'

  const possiblePaths = [
    join(rootDir, 'build', 'tiny-node', `node-${nodeVersion}-custom`, 'out', 'Release', nodeBinary),
    join(rootDir, 'build', 'tiny-node', 'node-yao-pkg', 'out', 'Release', nodeBinary),
    join(rootDir, 'build', 'tiny-node', 'node', 'out', 'Release', nodeBinary)
  ]

  let sourcePath = null
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      sourcePath = path
      break
    }
  }

  if (sourcePath) {
    console.log(`📦 Copying custom Node to pkg cache...`)
    console.log(`   From: ${sourcePath}`)
    console.log(`   To: ${cachePath}`)

    await mkdir(PKG_CACHE_DIR, { recursive: true })
    await copyFile(sourcePath, cachePath)
    console.log(`✅ Custom Node copied to cache`)
    return cachePath
  }

  throw new Error(
    `Custom Node.js binary not found\n` +
    `Expected at one of:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}\n` +
    `Run: node scripts/build-tiny-node.mjs --version=${nodeVersion}`
  )
}

export { ensureCustomNodeInCache }