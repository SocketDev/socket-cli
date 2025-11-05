/**
 * @fileoverview SEA (Single Executable Application) detection utilities for Socket ecosystem.
 * Provides reliable detection of whether the current process is running
 * as a Node.js Single Executable Application.
 */

import { normalizePath } from './path'

/**
 * Cached SEA detection result.
 */
let _isSea: boolean | undefined

/**
 * Get the current SEA binary path.
 * Only valid when running as a SEA binary.
 */
export function getSeaBinaryPath(): string | undefined {
  return isSeaBinary() && process.argv[0]
    ? normalizePath(process.argv[0])
    : undefined
}

/**
 * Detect if the current process is running as a SEA binary.
 * Uses Node.js 24+ native API with caching for performance.
 */
export function isSeaBinary(): boolean {
  if (_isSea === undefined) {
    try {
      // Use Node.js 24+ native SEA detection API.
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const seaModule = require('node:sea')
      _isSea = seaModule.isSea()
    } catch {
      // Node.js < 24 or SEA module not available.
      _isSea = false
    }
  }
  return _isSea ?? false
}
