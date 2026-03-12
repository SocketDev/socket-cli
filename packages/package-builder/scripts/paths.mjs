/**
 * Centralized path resolution for package-builder.
 *
 * This is the source of truth for all build output paths.
 * Follows ultrathink pattern: build/{mode}/out/{package}
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Package-builder root directory.
export const PACKAGE_BUILDER_ROOT = join(__dirname, '..')

// Template directories.
export const TEMPLATES_DIR = join(PACKAGE_BUILDER_ROOT, 'templates')
export const CLI_TEMPLATE_DIR = join(TEMPLATES_DIR, 'cli-package')
export const CLI_SENTRY_TEMPLATE_DIR = join(TEMPLATES_DIR, 'cli-sentry-package')
export const SOCKET_TEMPLATE_DIR = join(TEMPLATES_DIR, 'socket-package')
export const SOCKETBIN_TEMPLATE_DIR = join(TEMPLATES_DIR, 'socketbin-package')

/**
 * Get build mode (dev/prod).
 *
 * Priority:
 * 1. --dev or --prod CLI args
 * 2. BUILD_MODE env var
 * 3. CI env var (prod in CI, dev locally)
 */
export function getBuildMode() {
  // Check CLI args.
  const args = process.argv.slice(2)
  if (args.includes('--dev')) {
    return 'dev'
  }
  if (args.includes('--prod')) {
    return 'prod'
  }
  // Check env var.
  if (process.env.BUILD_MODE) {
    return process.env.BUILD_MODE
  }
  // Default based on CI.
  const isCI = process.env.CI === 'true' || process.env.CI === '1'
  return isCI ? 'prod' : 'dev'
}

/**
 * Get the build output root for a given mode.
 *
 * @param {string} [mode] - Build mode (dev/prod), defaults to BUILD_MODE or CI detection.
 * @returns {string} Path to build output root.
 */
export function getBuildOutDir(mode = getBuildMode()) {
  return join(PACKAGE_BUILDER_ROOT, 'build', mode, 'out')
}

/**
 * Get the output directory for a specific package.
 *
 * @param {string} packageName - Package directory name (e.g., 'cli', 'socketbin-cli-darwin-arm64').
 * @param {string} [mode] - Build mode (dev/prod), defaults to BUILD_MODE or CI detection.
 * @returns {string} Path to package output directory.
 */
export function getPackageOutDir(packageName, mode = getBuildMode()) {
  return join(getBuildOutDir(mode), packageName)
}

/**
 * Get the output path for a socketbin package.
 *
 * @param {string} platform - Platform identifier (darwin, linux, win32).
 * @param {string} arch - Architecture identifier (arm64, x64).
 * @param {string} [libc] - Linux libc variant ('musl' for Alpine).
 * @param {string} [mode] - Build mode (dev/prod), defaults to BUILD_MODE or CI detection.
 * @returns {string} Path to socketbin package directory.
 */
export function getSocketbinPackageDir(platform, arch, libc, mode = getBuildMode()) {
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  const packageName = `socketbin-cli-${platform}-${arch}${muslSuffix}`
  return getPackageOutDir(packageName, mode)
}

/**
 * Get the binary path within a socketbin package.
 *
 * @param {string} platform - Platform identifier (darwin, linux, win32).
 * @param {string} arch - Architecture identifier (arm64, x64).
 * @param {string} [libc] - Linux libc variant ('musl' for Alpine).
 * @param {string} [mode] - Build mode (dev/prod), defaults to BUILD_MODE or CI detection.
 * @returns {string} Path to the socket binary.
 */
export function getSocketbinBinaryPath(platform, arch, libc, mode = getBuildMode()) {
  const binaryName = platform === 'win32' ? 'socket.exe' : 'socket'
  return join(getSocketbinPackageDir(platform, arch, libc, mode), binaryName)
}
