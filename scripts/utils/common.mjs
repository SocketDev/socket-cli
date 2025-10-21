/**
 * @fileoverview Common utilities shared across all scripts.
 * Provides consistent helpers for running commands and logging.
 */

import { parseArgs as nodeParseArgs } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Platform detection
export const WIN32 = process.platform === 'win32'
export const MACOS = process.platform === 'darwin'
export const LINUX = process.platform === 'linux'

// Get the directory name from an import.meta.url
export function getDirname(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl))
}

/**
 * Get the root path of the project from a script location
 */
export function getRootPath(importMetaUrl, levelsUp = 2) {
  const dirname = getDirname(importMetaUrl)
  const segments = ['..'.repeat(levelsUp).split('').filter(Boolean)]
  return path.join(dirname, ...segments)
}

/**
 * Check if running in CI environment
 */
export function isCI() {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS
  )
}

/**
 * Check if running in debug mode
 */
export function isDebug() {
  return !!(process.env.DEBUG || process.env.NODE_ENV === 'development')
}

/**
 * Get command for checking if a binary exists
 */
export function getWhichCommand() {
  return WIN32 ? 'where' : 'which'
}

/**
 * Parse script arguments with common defaults
 */
export function parseScriptArgs(options = {}) {
  const defaultOptions = {
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
    quiet: {
      type: 'boolean',
      short: 'q',
      default: false,
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      default: false,
    },
    ...options,
  }

  return nodeParseArgs({
    options: defaultOptions,
    allowPositionals: true,
  })
}

/**
 * Exit with error message
 */
export function exitWithError(message, code = 1) {
  console.error(message)
  process.exitCode = code
}
