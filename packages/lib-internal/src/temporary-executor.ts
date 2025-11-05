/**
 * @fileoverview Temporary package executor detection utilities for Socket ecosystem.
 * Identifies and handles temporary execution contexts such as npx, pnpm dlx, and yarn dlx.
 */

import { WIN32 } from '#constants/platform'
import { normalizePath } from './path'

/**
 * Detects if the current process is running in a temporary package execution context
 * such as npm exec, npx, pnpm dlx, or yarn dlx.
 *
 * When package managers run commands via exec/npx/dlx, they execute in temporary directories
 * that are cleaned up after execution. Creating persistent shadows or modifying PATH
 * in these contexts can break subsequent package manager commands.
 */
export function isRunningInTemporaryExecutor(cwd = process.cwd()): boolean {
  // Check environment variable for exec/npx/dlx indicators.
  const userAgent = process.env['npm_config_user_agent']
  if (
    userAgent?.includes('exec') ||
    userAgent?.includes('npx') ||
    userAgent?.includes('dlx')
  ) {
    return true
  }

  // Normalize the cwd path for consistent checking across platforms.
  const normalizedCwd = normalizePath(cwd)

  // Check if running from npm's npx cache.
  const npmCache = process.env['npm_config_cache']
  if (npmCache && normalizedCwd.includes(normalizePath(npmCache))) {
    return true
  }

  // Check common temporary execution path patterns.
  const tempPatterns = [
    // npm's npx cache directory
    '_npx',
    // pnpm dlx temporary store
    '.pnpm-store',
    // Common dlx directory prefix
    'dlx-',
    // Yarn Berry PnP virtual packages.
    '.yarn/$$',
  ]

  // Yarn on Windows uses AppData/Local/Temp/xfs- pattern.
  if (WIN32) {
    tempPatterns.push('AppData/Local/Temp/xfs-')
  }

  return tempPatterns.some(pattern => normalizedCwd.includes(pattern))
}
