/**
 * Package manager agent constants.
 * Agent names, lockfile names, registry URLs, and configuration field names.
 */

// Agent names.
export const NPM = 'npm'
export const PNPM = 'pnpm'
export const YARN = 'yarn'
export const BUN = 'bun'
export const VLT = 'vlt'
export const NPX = 'npx'

// NPM binary path - resolved at runtime using which.
export const NPM_BIN_PATH = /*@__PURE__*/ (() => {
  try {
    const which = /*@__PURE__*/ require('which')
    return which.sync('npm', { nothrow: true }) || 'npm'
  } catch {
    return 'npm'
  }
})()

// NPM CLI entry point - resolved at runtime from npm bin location.
// NOTE: This is kept for backward compatibility but NPM_BIN_PATH should be used instead
// because cli.js exports a function that must be invoked, not executed directly.
export const NPM_REAL_EXEC_PATH = /*@__PURE__*/ (() => {
  try {
    const { existsSync } = /*@__PURE__*/ require('node:fs')
    const path = /*@__PURE__*/ require('node:path')
    const which = /*@__PURE__*/ require('which')
    // Find npm binary using which.
    const npmBin = which.sync('npm', { nothrow: true })
    if (!npmBin) {
      return undefined
    }
    // npm bin is typically at: /path/to/node/bin/npm
    // cli.js is at: /path/to/node/lib/node_modules/npm/lib/cli.js
    // /path/to/node/bin
    const npmDir = path.dirname(npmBin)
    const nodeModulesPath = path.join(
      npmDir,
      '..',
      'lib',
      'node_modules',
      'npm',
      'lib',
      'cli.js',
    )
    if (existsSync(nodeModulesPath)) {
      return nodeModulesPath
    }
    return undefined
  } catch {
    return undefined
  }
})()

// NPM registry URL.
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

// Agent variants.
export const YARN_BERRY = 'yarn/berry'
export const YARN_CLASSIC = 'yarn/classic'

// Lock files.
export const PACKAGE_LOCK = 'package-lock'
export const PACKAGE_LOCK_JSON = 'package-lock.json'
export const NPM_SHRINKWRAP_JSON = 'npm-shrinkwrap.json'
export const PNPM_LOCK = 'pnpm-lock'
export const PNPM_LOCK_YAML = 'pnpm-lock.yaml'
export const YARN_LOCK = 'yarn.lock'
export const BUN_LOCK = 'bun.lock'
export const BUN_LOCKB = 'bun.lockb'
export const VLT_LOCK_JSON = 'vlt-lock.json'

// Workspace configuration.
export const PNPM_WORKSPACE_YAML = 'pnpm-workspace.yaml'

// Package.json fields for dependency overrides.
export const OVERRIDES = 'overrides'
export const RESOLUTIONS = 'resolutions'
