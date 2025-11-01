/**
 * File path and directory constants for Socket CLI.
 * Consolidates both static paths and lazy-loaded path computations.
 */

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getExecPath,
  getNodeHardenFlags,
  getNodeNoWarningsFlags,
} from '@socketsecurity/lib/constants/node'
import { DOT_SOCKET_DIR } from '@socketsecurity/lib/constants/paths'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import ENV from './env.mts'

// Import socket constants for re-export.
import { SOCKET_JSON } from './socket.mts'

// Re-export socket constants for backward compatibility.
export { SOCKET_JSON }

// Re-export node-related constants from registry for convenience.
export { getExecPath, getNodeHardenFlags, getNodeNoWarningsFlags }

// Export as non-function constants for backward compatibility.
export const execPath = getExecPath()
export const nodeHardenFlags = getNodeHardenFlags()
export const nodeNoWarningsFlags = getNodeNoWarningsFlags()

// Get base paths relative to this file's location
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Static Base Paths (eagerly computed)
// In unified build, this file is bundled into dist/cli.js, so __dirname will be the dist directory.
// In normal build, this file stays in src/constants, so __dirname is src/constants.
export const srcPath = path.resolve(__dirname, '..')
// If srcPath ends with 'dist', we're in the bundled CLI, so rootPath is one level up from dist.
// Otherwise, we're in source code where srcPath is 'src', so rootPath is one level up from src.
export const rootPath = path.resolve(srcPath, '..')
export const distPath = path.join(rootPath, 'dist')
export const configPath = path.join(rootPath, '.config')
export const externalPath = path.join(rootPath, 'external')
export const homePath = homedir()

// Configuration File Names (CLI-specific)
export const ENVIRONMENT_YAML = 'environment.yaml'
export const ENVIRONMENT_YML = 'environment.yml'
export const REQUIREMENTS_TXT = 'requirements.txt'

// Lockfile Names (CLI-specific)
export const PACKAGE_LOCK_JSON = 'package-lock.json'
export const PNPM_LOCK_YAML = 'pnpm-lock.yaml'
export const YARN_LOCK = 'yarn.lock'

// Directory Names (CLI-specific)
export const UPDATE_STORE_DIR = '.socket/_socket'

// Derived Paths (CLI-specific)
export const DOT_SOCKET_DOT_FACTS_JSON = `${DOT_SOCKET_DIR}.facts.json`

// Update Store
export const UPDATE_STORE_FILE_NAME = 'update-store.json'

// Lazy Path Getters (computed on first access)

export function getBashRcPath(): string {
  return path.join(homedir(), '.bashrc')
}

export function getZshRcPath(): string {
  return path.join(homedir(), '.zshrc')
}

export function getBinPath(): string {
  return path.join(rootPath, 'bin')
}

export function getBinCliPath(): string {
  // Allow overriding CLI binary path for testing built binaries (SEA, yao-pkg, etc).
  const binPath = ENV.SOCKET_CLI_BIN_PATH
  if (binPath) {
    return binPath
  }
  return path.join(rootPath, 'dist/index.js')
}

export function getDistPath(): string {
  return distPath
}

export function getDistBinPath(): string {
  return path.join(distPath, 'bin')
}

export function getDistPackageJsonPath(): string {
  return path.join(distPath, 'package.json')
}

export function getPackageJsonPath(): string {
  return path.join(rootPath, 'package.json')
}

export function getShadowBinPath(): string {
  return path.join(rootPath, 'shadow-bin')
}

// Export shadowBinPath as a constant for backward compatibility.
export const shadowBinPath = path.join(rootPath, 'shadow-bin')

export function getShadowNpmBinPath(): string {
  return path.join(distPath, 'shadow-npm-bin.js')
}

export function getShadowNpmInjectPath(): string {
  return path.join(distPath, 'shadow-npm-inject.js')
}

export function getInstrumentWithSentryPath(): string {
  return path.join(distPath, 'instrument-with-sentry.js')
}

// Export as constants for backward compatibility.
export const shadowNpmInjectPath = path.join(distPath, 'shadow-npm-inject.js')
export const instrumentWithSentryPath = path.join(
  distPath,
  'instrument-with-sentry.js',
)

export function getShadowNpxBinPath(): string {
  return path.join(distPath, 'shadow-npx-bin.js')
}

export function getShadowPnpmBinPath(): string {
  return path.join(distPath, 'shadow-pnpm-bin.js')
}

export function getShadowYarnBinPath(): string {
  return path.join(distPath, 'shadow-yarn-bin.js')
}

export function getBlessedPath(): string {
  return path.join(externalPath, 'blessed')
}

export function getBlessedContribPath(): string {
  return path.join(externalPath, 'blessed-contrib')
}

export function getBlessedOptions() {
  const blessedColorDepth = (ENV.TERM ?? '').includes('256color') ? 256 : 8
  return {
    __proto__: null,
    fullUnicode: true,
    // https://github.com/chjj/blessed/issues/327
    titleShrink: true,
    // See https://github.com/chjj/blessed/pull/219
    input: process.stdin,
    output: process.stdout,
    terminal: blessedColorDepth === 256 ? 'xterm-256color' : 'xterm',
  }
}

export function getSocketAppDataPath(): string | undefined {
  // Get the OS app data directory:
  // - Win: %LOCALAPPDATA% or fallback to %USERPROFILE%/AppData/Local
  // - Mac: %XDG_DATA_HOME% or fallback to "~/Library/Application Support/"
  // - Linux: %XDG_DATA_HOME% or fallback to "~/.local/share/"
  // Note: LOCALAPPDATA typically points to user's AppData\Local directory.
  // Note: XDG stands for "X Desktop Group", nowadays "freedesktop.org"
  //       On most systems that path is: $HOME/.local/share
  // Then append `socket/settings`, so:
  // - Win: %LOCALAPPDATA%\socket\settings or %USERPROFILE%\AppData\Local\socket\settings
  // - Mac: %XDG_DATA_HOME%/socket/settings or "~/Library/Application Support/socket/settings"
  // - Linux: %XDG_DATA_HOME%/socket/settings or "~/.local/share/socket/settings"
  const isWin32 = process.platform === 'win32'
  let dataHome: string | undefined = isWin32
    ? ENV.LOCALAPPDATA
    : ENV.XDG_DATA_HOME
  if (!dataHome) {
    const home = homedir()
    if (isWin32) {
      // Fallback: Use USERPROFILE or HOME when LOCALAPPDATA is missing.
      dataHome = path.join(home, 'AppData', 'Local')
      getDefaultLogger().warn('LOCALAPPDATA not set, using fallback path.')
    } else {
      const isDarwin = process.platform === 'darwin'
      dataHome = path.join(
        home,
        isDarwin ? 'Library/Application Support' : '.local/share',
      )
    }
  }
  return dataHome ? path.join(dataHome, 'socket', 'settings') : undefined
}

export function getSocketCachePath(): string {
  const xdgCacheHome = ENV.XDG_CACHE_HOME
  if (xdgCacheHome) {
    return path.join(xdgCacheHome, 'socket')
  }
  const platform = process.platform
  const home = homedir()
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Caches', 'socket')
    case 'win32': {
      const tempDir =
        ENV.TEMP || ENV.TMP || path.join(home, 'AppData', 'Local', 'Temp')
      return path.join(tempDir, 'socket')
    }
    default:
      return path.join(home, '.cache', 'socket')
  }
}

export function getSocketRegistryPath(): string {
  const appDataPath = getSocketAppDataPath()
  if (!appDataPath) {
    throw new Error('Unable to determine Socket app data path')
  }
  return path.join(appDataPath, 'registry')
}

export function getGithubCachePath(): string {
  return path.join(getSocketCachePath(), 'github')
}

// Package Manager Resolution Paths
// Helper for creating require.
const require = createRequire(import.meta.url)

export function getNmBunPath(): string | undefined {
  try {
    return realpathSync(require.resolve('bun/package.json'))
  } catch {
    return undefined
  }
}

export function getNmNpmPath(): string {
  try {
    return realpathSync(require.resolve('npm/package.json'))
  } catch {
    return 'npm'
  }
}

export function getNmNodeGypPath(): string | undefined {
  try {
    return realpathSync(require.resolve('node-gyp/package.json'))
  } catch {
    return undefined
  }
}

export function getNmPnpmPath(): string | undefined {
  try {
    return realpathSync(require.resolve('pnpm/package.json'))
  } catch {
    return undefined
  }
}

export function getNmYarnPath(): string | undefined {
  try {
    return realpathSync(require.resolve('yarn/package.json'))
  } catch {
    return undefined
  }
}
