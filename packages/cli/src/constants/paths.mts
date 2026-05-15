/**
 * File path and directory constants for Socket CLI.
 * Consolidates both static paths and lazy-loaded path computations.
 */

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getExecPath,
  getNodeHardenFlags,
  getNodeNoWarningsFlags,
} from '@socketsecurity/lib-stable/constants/node'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { DOT_SOCKET_DIR } from '@socketsecurity/lib-stable/paths/dirnames'

import { ENV } from './env.mts'

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
// In unified build, this file is bundled into dist/cli.js or build/cli.js, so __dirname will be the dist or build directory.
// In normal build, this file stays in src/constants, so __dirname is src/constants.
export const srcPath = path.resolve(__dirname, '..')
// If __dirname ends with 'dist' or 'build', we're in the bundled CLI, so rootPath is srcPath (one level up from dist/build).
// Otherwise, we're in source code where srcPath is 'src', so rootPath is one level up from src.
export const rootPath =
  __dirname.endsWith('dist') || __dirname.endsWith('build')
    ? srcPath
    : path.resolve(srcPath, '..')
export const distPath = path.join(rootPath, 'dist')
export const configPath = path.join(rootPath, '.config')
export const externalPath = path.join(rootPath, 'external')
export const homePath = os.homedir()

// Configuration File Names (CLI-specific)
export const ENVIRONMENT_YAML = 'environment.yaml'
export const ENVIRONMENT_YML = 'environment.yml'
export const REQUIREMENTS_TXT = 'requirements.txt'

// Lockfile Names (CLI-specific)
export const PACKAGE_LOCK_JSON = 'package-lock.json'
export const PNPM_LOCK_YAML = 'pnpm-lock.yaml'
export const YARN_LOCK = 'yarn.lock'

// Directory Names (CLI-specific)
export const UPDATE_STORE_DIR = '.socket/_dlx'

// Derived Paths (CLI-specific)
export const DOT_SOCKET_DOT_FACTS_JSON = `${DOT_SOCKET_DIR}.facts.json`

// Update Store
export const UPDATE_STORE_FILE_NAME = '.dlx-manifest.json'

// Lazy Path Getters (computed on first access)

// Package Manager Resolution Paths
// Helper for creating require.
const require = createRequire(import.meta.url)

export function getBashRcPath(): string {
  return path.join(os.homedir(), '.bashrc')
}

export function getBinCliPath(): string {
  // Allow overriding CLI binary path for testing built binaries (SEA, yao-pkg, etc).
  const binPath = ENV.SOCKET_CLI_BIN_PATH
  if (binPath) {
    // Resolve relative paths against project root to support cwd changes in tests.
    return path.isAbsolute(binPath) ? binPath : path.join(rootPath, binPath)
  }
  /* c8 ignore start - .env.test always sets SOCKET_CLI_BIN_PATH so the fallback is unreachable in unit tests */
  return path.join(rootPath, 'dist/index.js')
  /* c8 ignore stop */
}

export function getBinPath(): string {
  return path.join(rootPath, 'bin')
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

export function getBlessedPath(): string {
  return path.join(externalPath, 'blessed')
}

export function getDistBinPath(): string {
  return path.join(distPath, 'bin')
}

export function getDistPackageJsonPath(): string {
  return path.join(distPath, 'package.json')
}

export function getDistPath(): string {
  return distPath
}

export function getGithubCachePath(): string {
  return path.join(getSocketCachePath(), 'github')
}

export function getNmBunPath(): string | undefined {
  try {
    return realpathSync(require.resolve('bun/package.json'))
  } catch {
    return undefined
  }
}

export function getNmNodeGypPath(): string | undefined {
  try {
    /* c8 ignore start - node-gyp is not installed in tests; require.resolve throws before realpathSync runs */
    return realpathSync(require.resolve('node-gyp/package.json'))
    /* c8 ignore stop */
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

export function getPackageJsonPath(): string {
  return path.join(rootPath, 'package.json')
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
    const home = os.homedir()
    /* c8 ignore start - WIN32-only fallback when LOCALAPPDATA env var missing; tests run on macOS/Linux */
    if (isWin32) {
      dataHome = path.join(home, 'AppData', 'Local')
      const logger = getDefaultLogger()
      logger.warn('LOCALAPPDATA not set, using fallback path.')
      /* c8 ignore stop */
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
  const home = os.homedir()
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
  /* c8 ignore start - HOME/USERPROFILE/LOCALAPPDATA/XDG_DATA_HOME all unset is essentially impossible in any real environment */
  if (!appDataPath) {
    throw new Error(
      `could not determine the Socket app-data directory: getSocketAppDataPath() returned undefined because none of HOME, USERPROFILE, LOCALAPPDATA, or XDG_DATA_HOME are set; export one of those env vars (typically HOME on macOS/Linux or LOCALAPPDATA on Windows) and retry`,
    )
  }
  /* c8 ignore stop */
  return path.join(appDataPath, 'registry')
}

export function getZshRcPath(): string {
  return path.join(os.homedir(), '.zshrc')
}
