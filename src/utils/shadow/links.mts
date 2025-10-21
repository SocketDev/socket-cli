/**
 * Shadow binary link installation utilities for Socket CLI.
 * Manages installation of shadow binaries for package managers.
 *
 * Key Functions:
 * - installNpmLinks: Install shadow links for npm binary
 * - installNpxLinks: Install shadow links for npx binary
 * - installPnpmLinks: Install shadow links for pnpm binary
 * - installYarnLinks: Install shadow links for yarn binary
 *
 * Shadow Installation:
 * - Creates symlinks/cmd-shims to intercept package manager commands
 * - Modifies PATH to prioritize shadow binaries
 * - Skips installation in temporary execution contexts
 *
 * Security Integration:
 * - Enables security scanning before package operations
 * - Transparent interception of package manager commands
 * - Preserves original binary functionality
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import cmdShim from 'cmd-shim'

import { getDistPath } from '../../constants/paths.mts'
import { shouldSkipShadow } from '../dlx/detection.mts'
import {
  getNpmBinPath,
  getNpxBinPath,
  isNpmBinPathShadowed,
  isNpxBinPathShadowed,
} from '../npm/paths.mts'
import { getPnpmBinPath, isPnpmBinPathShadowed } from '../pnpm/paths.mts'
import { getYarnBinPath, isYarnBinPathShadowed } from '../yarn/paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function installNpmLinks(shadowBinPath: string): Promise<string> {
  // Find npm being shadowed by this process.
  const binPath = getNpmBinPath()
  const distPath = getDistPath()

  // Skip shadow installation when in temporary execution context or when required for Windows.
  if (shouldSkipShadow(binPath, { cwd: __dirname, win32: WIN32 })) {
    return binPath
  }
  const shadowed = isNpmBinPathShadowed()
  // Move our bin directory to front of PATH so its found first.
  if (!shadowed) {
    if (WIN32) {
      try {
        await cmdShim(
          path.join(distPath, 'npm-cli.js'),
          path.join(shadowBinPath, 'npm'),
        )
      } catch (e) {
        throw new Error(
          `failed to create npm cmd shim: ${(e as Error).message}`,
          { cause: e },
        )
      }
    }
    const { env } = process
    env['PATH'] = `${shadowBinPath}${path.delimiter}${env['PATH']}`
  }
  return binPath
}

export async function installNpxLinks(shadowBinPath: string): Promise<string> {
  // Find npx being shadowed by this process.
  const binPath = getNpxBinPath()
  const distPath = getDistPath()

  // Skip shadow installation when in temporary execution context or when required for Windows.
  if (shouldSkipShadow(binPath, { cwd: __dirname, win32: WIN32 })) {
    return binPath
  }
  const shadowed = isNpxBinPathShadowed()
  // Move our bin directory to front of PATH so its found first.
  if (!shadowed) {
    if (WIN32) {
      try {
        await cmdShim(
          path.join(distPath, 'npx-cli.js'),
          path.join(shadowBinPath, 'npx'),
        )
      } catch (e) {
        throw new Error(
          `failed to create npx cmd shim: ${(e as Error).message}`,
          { cause: e },
        )
      }
    }
    const { env } = process
    env['PATH'] = `${shadowBinPath}${path.delimiter}${env['PATH']}`
  }
  return binPath
}

export async function installPnpmLinks(shadowBinPath: string): Promise<string> {
  // Find pnpm being shadowed by this process.
  const binPath = getPnpmBinPath()
  const distPath = getDistPath()

  // Skip shadow installation when in temporary execution context or when required for Windows.
  if (shouldSkipShadow(binPath, { cwd: __dirname, win32: WIN32 })) {
    return binPath
  }

  const shadowed = isPnpmBinPathShadowed()

  // Move our bin directory to front of PATH so its found first.
  if (!shadowed) {
    if (WIN32) {
      try {
        await cmdShim(
          path.join(distPath, 'pnpm-cli.js'),
          path.join(shadowBinPath, 'pnpm'),
        )
      } catch (e) {
        throw new Error(
          `failed to create pnpm cmd shim: ${(e as Error).message}`,
          { cause: e },
        )
      }
    }
    const { env } = process
    env['PATH'] = `${shadowBinPath}${path.delimiter}${env['PATH']}`
  }

  return binPath
}

export async function installYarnLinks(shadowBinPath: string): Promise<string> {
  const binPath = getYarnBinPath()
  const distPath = getDistPath()

  // Skip shadow installation when in temporary execution context or when required for Windows.
  if (shouldSkipShadow(binPath, { cwd: __dirname, win32: WIN32 })) {
    return binPath
  }

  const shadowed = isYarnBinPathShadowed()

  if (!shadowed) {
    if (WIN32) {
      try {
        await cmdShim(
          path.join(distPath, 'yarn-cli.js'),
          path.join(shadowBinPath, 'yarn'),
        )
      } catch (e) {
        throw new Error(
          `failed to create yarn cmd shim: ${(e as Error).message}`,
          { cause: e },
        )
      }
    }
    const { env } = process
    env['PATH'] = `${shadowBinPath}${path.delimiter}${env['PATH']}`
  }

  return binPath
}
