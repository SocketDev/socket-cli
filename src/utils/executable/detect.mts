/**
 * SEA (Single Executable Application) detection utilities for Socket CLI.
 * Provides reliable detection of whether the current process is running
 * as a Node.js Single Executable Application.
 *
 * Key Functions:
 * - isSeaBinary: Detect if running as SEA with caching
 * - getSeaBinaryPath: Get the current SEA binary path
 *
 * Detection Method:
 * - Uses Node.js 24+ native sea.isSea() API
 * - Caches result for performance
 * - Graceful fallback for unsupported versions
 *
 * Features:
 * - Cached detection for performance
 * - Error-resistant implementation
 * - Support for Node.js 24+ SEA API
 *
 * Usage:
 * - Detecting SEA execution context
 * - Conditional SEA-specific functionality
 * - Update notification customization
 */

 

import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

const require = createRequire(import.meta.url)

/**
 * Cached SEA detection result.
 */
let _isSea: boolean | undefined

/**
 * Detect if the current process is running as a SEA binary.
 * Uses Node.js 24+ native API with caching for performance.
 */
function isSeaBinary(): boolean {
  if (_isSea === undefined) {
    try {
      // Use Node.js 24+ native SEA detection API.
      const seaModule = require('node:sea')
      _isSea = seaModule.isSea()
    } catch {
      _isSea = false
    }
  }
  return _isSea ?? false
}

/**
 * Get the current SEA binary path.
 * Only valid when running as a SEA binary.
 */
function getSeaBinaryPath(): string | undefined {
  return isSeaBinary() ? process.argv[0] : undefined
}

export { getSeaBinaryPath, isSeaBinary }
