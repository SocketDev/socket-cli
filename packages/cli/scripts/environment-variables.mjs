/**
 * @fileoverview Unified environment variable management for Socket CLI builds and tests.
 * Single source of truth for all inlined environment variables.
 *
 * This module consolidates environment variable loading that was previously duplicated between:
 * - esbuild-shared.mjs (full build-time inlining with 18 variables)
 * - test-wrapper.mjs (partial test environment with 4 variables)
 *
 * Usage:
 *   import { EnvironmentVariables } from './environment-variables.mjs'
 *   const vars = EnvironmentVariables.load()
 *   const defines = EnvironmentVariables.getDefineEntries(vars)
 *   const testVars = EnvironmentVariables.getTestVariables(vars)
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { getPackageOutDir } from 'package-builder/scripts/paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

/**
 * Environment variables manager for Socket CLI.
 * Provides unified loading of build-time and test-time environment variables.
 */
export class EnvironmentVariables {
  /**
   * Load all inlined environment variables with their raw values.
   * This is the single source of truth for all environment variable data.
   *
   * @returns {Object} Object with all environment variable values (not JSON-stringified)
   */
  static load() {
    // Read package.json for metadata.
    const packageJson = JSON.parse(
      readFileSync(path.join(rootPath, 'package.json'), 'utf-8'),
    )

    // Read version from socket package (the published package).
    // Uses centralized paths from package-builder.
    const socketPackageJson = JSON.parse(
      readFileSync(path.join(getPackageOutDir('cli'), 'package.json'), 'utf-8'),
    )

    // Get current git commit hash.
    let gitHash = ''
    try {
      gitHash = execSync('git rev-parse --short HEAD', {
        cwd: rootPath,
        encoding: 'utf-8',
      }).trim()
    } catch {}

    // Get external tool versions from external-tools.json.
    const externalTools = JSON.parse(
      readFileSync(path.join(rootPath, 'external-tools.json'), 'utf-8'),
    )

    /**
     * Helper to get external tool version with validation.
     */
    function getExternalToolVersion(key, field = 'version') {
      const tool = externalTools[key]
      if (!tool) {
        throw new Error(
          `External tool "${key}" not found in external-tools.json. Please add it to the configuration.`,
        )
      }
      const value = tool[field]
      if (!value) {
        throw new Error(
          `External tool "${key}" is missing required field "${field}" in external-tools.json.`,
        )
      }
      return value
    }

    // npm packages use 'version' field.
    const cdxgenVersion = getExternalToolVersion('@cyclonedx/cdxgen')
    const coanaVersion = getExternalToolVersion('@coana-tech/cli')
    const synpVersion = getExternalToolVersion('synp')
    // pypi packages use 'version' field.
    const pyCliVersion = getExternalToolVersion('socketsecurity')
    // github-release tools use 'githubRelease' field (release tag, any format).
    const opengrepVersion = getExternalToolVersion('opengrep', 'githubRelease')
    const pythonBuildTag = getExternalToolVersion('python', 'buildTag')
    const pythonVersion = getExternalToolVersion('python', 'githubRelease')
    const socketPatchVersion = getExternalToolVersion('socket-patch', 'githubRelease')
    const trivyVersion = getExternalToolVersion('trivy', 'githubRelease')
    const trufflehogVersion = getExternalToolVersion('trufflehog', 'githubRelease')
    // sfw uses both: GitHub binary for SEA, npm package for CLI.
    const sfwVersion = getExternalToolVersion('sfw', 'githubRelease')
    const sfwNpmVersion = getExternalToolVersion('sfw', 'npmVersion')

    // Build-time constants that can be overridden by environment variables.
    const publishedBuild =
      process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] === '1'
    const sentryBuild = process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'] === '1'

    // Compute version hash (matches Rollup implementation).
    const randUuidSegment = randomUUID().split('-')[0]
    const versionHash = `${packageJson.version}:${gitHash}:${randUuidSegment}${
      publishedBuild ? '' : ':dev'
    }`

    // Get checksums for tools that have them.
    const pythonChecksums = externalTools.python?.checksums || {}
    const socketPatchChecksums = externalTools['socket-patch']?.checksums || {}

    // Return all environment variables with raw values.
    return {
      INLINED_SOCKET_CLI_CDXGEN_VERSION: cdxgenVersion,
      INLINED_SOCKET_CLI_COANA_VERSION: coanaVersion,
      INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: cdxgenVersion,
      INLINED_SOCKET_CLI_HOMEPAGE: packageJson.homepage,
      INLINED_SOCKET_CLI_NAME: packageJson.name,
      INLINED_SOCKET_CLI_OPENGREP_VERSION: opengrepVersion,
      INLINED_SOCKET_CLI_PUBLISHED_BUILD: publishedBuild ? '1' : '',
      INLINED_SOCKET_CLI_PYCLI_VERSION: pyCliVersion,
      INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: pythonBuildTag,
      INLINED_SOCKET_CLI_PYTHON_CHECKSUMS: JSON.stringify(pythonChecksums),
      INLINED_SOCKET_CLI_PYTHON_VERSION: pythonVersion,
      INLINED_SOCKET_CLI_SENTRY_BUILD: sentryBuild ? '1' : '',
      INLINED_SOCKET_CLI_SFW_NPM_VERSION: sfwNpmVersion,
      INLINED_SOCKET_CLI_SFW_VERSION: sfwVersion,
      INLINED_SOCKET_CLI_SOCKET_PATCH_CHECKSUMS: JSON.stringify(socketPatchChecksums),
      INLINED_SOCKET_CLI_SOCKET_PATCH_VERSION: socketPatchVersion,
      INLINED_SOCKET_CLI_SYNP_VERSION: synpVersion,
      INLINED_SOCKET_CLI_TRIVY_VERSION: trivyVersion,
      INLINED_SOCKET_CLI_TRUFFLEHOG_VERSION: trufflehogVersion,
      INLINED_SOCKET_CLI_VERSION: socketPackageJson.version,
      INLINED_SOCKET_CLI_VERSION_HASH: versionHash,
    }
  }

  /**
   * Load external tool versions with error handling (for test environment).
   * This is a safe subset that won't throw if files are missing.
   *
   * @returns {Object} Object with tool versions or empty object if loading fails
   */
  static loadSafe() {
    try {
      const externalTools = JSON.parse(
        readFileSync(path.join(rootPath, 'external-tools.json'), 'utf8'),
      )
      return {
        INLINED_SOCKET_CLI_COANA_VERSION:
          externalTools['@coana-tech/cli']?.version || '',
        INLINED_SOCKET_CLI_PYCLI_VERSION:
          externalTools.socketsecurity?.version || '',
        INLINED_SOCKET_CLI_SFW_NPM_VERSION: externalTools.sfw?.npmVersion || '',
        INLINED_SOCKET_CLI_SFW_VERSION: externalTools.sfw?.githubRelease || '',
        INLINED_SOCKET_CLI_SOCKET_PATCH_VERSION:
          externalTools['socket-patch']?.githubRelease || '',
      }
    } catch {
      return {}
    }
  }

  /**
   * Get environment variables formatted for esbuild define option.
   * All values are JSON-stringified for esbuild compatibility.
   *
   * @param {Object} [vars] - Pre-loaded variables (optional, will load if not provided)
   * @returns {Record<string, string>} Object with env var names as keys and JSON-stringified values
   */
  static getDefineEntries(vars) {
    const envVars = vars || EnvironmentVariables.load()

    // Convert all values to JSON-stringified format for esbuild.
    const defines = {}
    for (const [key, value] of Object.entries(envVars)) {
      defines[key] = JSON.stringify(value)
    }
    return defines
  }

  /**
   * Get subset of environment variables needed for test environment.
   * Returns only the tool versions needed by tests, with safe loading.
   *
   * @returns {Object} Object with test environment variables
   */
  static getTestVariables() {
    return EnvironmentVariables.loadSafe()
  }
}
