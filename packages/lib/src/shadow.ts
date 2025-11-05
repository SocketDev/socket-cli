/**
 * @fileoverview Shadow binary installation utilities for Socket ecosystem.
 * Provides logic to determine when shadow binary installation should be skipped.
 */

import { normalizePath } from './path'

export interface ShadowInstallationOptions {
  cwd?: string | undefined
  win32?: boolean | undefined
}

/**
 * Determines if shadow binaries should be installed.
 * Shadows should NOT be installed when:
 * - Running in a temporary execution context (exec/npx/dlx)
 * - On Windows with an existing binary path (required for Windows to function)
 *
 * @param binPath - Path to the binary being shadowed
 * @param options - Configuration options
 * @param options.cwd - Current working directory path to check
 * @param options.win32 - Whether running on Windows
 * @returns true if shadow installation should be skipped
 */
export function shouldSkipShadow(
  binPath: string,
  options?: ShadowInstallationOptions | undefined,
): boolean {
  const { cwd = process.cwd(), win32 = false } = {
    __proto__: null,
    ...options,
  } as ShadowInstallationOptions

  // Windows compatibility: Skip shadow installation if binary is already found.
  //
  // This check is required because Windows handles executables differently than Unix:
  // 1. File locking - Windows locks running executables, so cmd-shim creation would
  //    fail with EBUSY/EACCES errors when trying to create wrapper files.
  // 2. PATH conflicts - Attempting to shadow an already-resolved binary can create
  //    circular references or ambiguous command resolution.
  // 3. Registry integration - Windows package managers often use system-level
  //    integrations beyond just PATH that our shadowing would interfere with.
  //
  // Without this check, users would see "Access Denied" or file locking errors
  // that are difficult to debug. This is not a performance optimization - the
  // shadow installation will fail without it.
  if (win32 && binPath) {
    return true
  }

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
    // Yarn on Windows uses normalized forward slash paths.
    'AppData/Local/Temp/xfs-',
  ]

  return tempPatterns.some(pattern => normalizedCwd.includes(pattern))
}
