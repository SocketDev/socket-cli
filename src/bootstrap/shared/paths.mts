/**
 * Shared path resolution for all bootstrap implementations.
 * This file is bundled into each bootstrap, not imported at runtime.
 */

import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Get the Socket home directory path.
 * Supports SOCKET_HOME environment variable override.
 */
export function getSocketHome(): string {
  return process.env['SOCKET_HOME'] || path.join(homedir(), '.socket')
}

/**
 * Get the stub binary installation directory.
 * This is where SEA/yao-pkg executables are cached.
 */
export function getStubDir(): string {
  return path.join(getSocketHome(), '_cli')
}

/**
 * Get the DLX cache directory for downloaded packages.
 * This is where @socketsecurity/cli and other packages are installed.
 */
export function getDlxDir(): string {
  return path.join(getSocketHome(), '_dlx')
}

/**
 * Get the CLI package directory within DLX cache.
 */
export function getCliPackageDir(): string {
  return path.join(getDlxDir(), 'cli')
}

/**
 * Get the CLI entry point path.
 */
export function getCliEntryPoint(): string {
  return path.join(getCliPackageDir(), 'dist', 'cli.js')
}

/**
 * Get npm registry URL with environment variable support.
 */
export function getRegistryUrl(): string {
  return (
    process.env['SOCKET_NPM_REGISTRY'] ||
    process.env['NPM_REGISTRY'] ||
    'https://registry.npmjs.org'
  )
}

/**
 * Get package name to download.
 */
export function getCliPackageName(): string {
  return process.env['SOCKET_CLI_PACKAGE'] || '@socketsecurity/cli'
}
