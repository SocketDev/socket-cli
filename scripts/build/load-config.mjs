/**
 * @fileoverview Load build configuration from JSON5 format with comments
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import stripJsonComments from 'strip-json-comments'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')

/**
 * Load build configuration from JSON5 or JSON file
 * @returns {Object} Parsed configuration object
 */
export function loadBuildConfig() {
  const json5Path = join(ROOT_DIR, '.config', 'build-config.json5')
  const jsonPath = join(ROOT_DIR, '.config', 'build-config.json')

  // Try JSON5 first (with comments)
  if (existsSync(json5Path)) {
    const content = readFileSync(json5Path, 'utf8')
    const stripped = stripJsonComments(content)
    return JSON.parse(stripped)
  }

  // Fall back to regular JSON
  if (existsSync(jsonPath)) {
    return JSON.parse(readFileSync(jsonPath, 'utf8'))
  }

  // Return empty config if neither exists
  console.warn('No build configuration found at .config/build-config.json5 or .config/build-config.json')
  return {}
}

/**
 * Get the node directory name (simplified without "node-" prefix or "custom" suffix)
 * @param {string} version - Node version (e.g., "v24.9.0")
 * @param {boolean} isCustom - Whether this is our custom build
 * @returns {string} Directory name (e.g., "v24.9.0")
 */
export function getNodeDirName(version, _isCustom = false) {
  // Just use the version directly, no prefixes or suffixes
  return version
}

/**
 * Get binary name for storage
 * @param {string} version - Node version
 * @param {string} platform - Platform (darwin, linux, win)
 * @param {string} arch - Architecture (arm64, x64)
 * @returns {string} Binary name (e.g., "v24.9.0-darwin-arm64")
 */
export function getBinaryName(version, platform, arch) {
  return `${version}-${platform}-${arch}`
}

export default loadBuildConfig