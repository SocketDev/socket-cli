/**
 * Lazy-loaded constants that require runtime computation.
 * These are evaluated on first access to avoid initialization issues.
 */

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import registryConstants from '@socketsecurity/registry/lib/constants'

const registryConstantsAttribs = (registryConstants as any).attributes || {
  getters: {},
}

import { distPath, rootPath, srcPath, externalPath } from './static.mts'

// Lazy getter functions for paths
function lazyBashRcPath() {
  return path.join(homedir(), '.bashrc')
}

function lazyBinCliPath() {
  return path.join(rootPath, 'bin/cli.js')
}

function lazyBinPath() {
  return path.join(rootPath, 'bin')
}

function lazyBlessedContribPath() {
  return path.join(externalPath, 'blessed-contrib')
}

function lazyBlessedOptions() {
  const blessedColorDepth = (process.env['TERM'] ?? '').includes('256color')
    ? 256
    : 8
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

function lazyBlessedPath() {
  return path.join(externalPath, 'blessed')
}

function lazyDistBinPath() {
  return path.join(distPath, 'bin')
}

function lazyDistPackageJsonPath() {
  return path.join(distPath, 'package.json')
}

function lazyNmBunPath() {
  try {
    return realpathSync(require.resolve('bun/package.json'))
  } catch {
    return undefined
  }
}

function lazyNmNpmPath() {
  try {
    return realpathSync(require.resolve('npm/package.json'))
  } catch {
    return 'npm'
  }
}

function lazyNmNodeGypPath() {
  try {
    return realpathSync(require.resolve('node-gyp/package.json'))
  } catch {
    return undefined
  }
}

function lazyNmPnpmPath() {
  try {
    return realpathSync(require.resolve('pnpm/package.json'))
  } catch {
    return undefined
  }
}

function lazyNmYarnPath() {
  try {
    return realpathSync(require.resolve('yarn/package.json'))
  } catch {
    return undefined
  }
}

function lazyPackageJsonPath() {
  return path.join(rootPath, 'package.json')
}

function lazyShadowBinPath() {
  return path.join(rootPath, 'shadow-bin')
}

function lazyShadowNpmBinPath() {
  return path.join(distPath, 'shadow-npm-bin.js')
}

function lazyShadowNpmInjectPath() {
  return path.join(distPath, 'shadow-npm-inject.js')
}

function lazyShadowNpxBinPath() {
  return path.join(distPath, 'shadow-npx-bin.js')
}

function lazyShadowPnpmBinPath() {
  return path.join(distPath, 'shadow-pnpm-bin.js')
}

function lazyShadowYarnBinPath() {
  return path.join(distPath, 'shadow-yarn-bin.js')
}

function lazySocketAppDataPath() {
  const xdgDataHome = process.env['XDG_DATA_HOME']
  if (xdgDataHome) {
    return path.join(xdgDataHome, 'socket')
  }
  const platform = process.platform
  const home = homedir()
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Socket')
    case 'win32':
      return path.join(
        process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local'),
        'Socket',
      )
    default:
      return path.join(home, '.local', 'share', 'socket')
  }
}

function lazySocketCachePath() {
  const xdgCacheHome = process.env['XDG_CACHE_HOME']
  if (xdgCacheHome) {
    return path.join(xdgCacheHome, 'socket')
  }
  const platform = process.platform
  const home = homedir()
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Caches', 'socket')
    case 'win32':
      const tempDir =
        process.env['TEMP'] ||
        process.env['TMP'] ||
        path.join(home, 'AppData', 'Local', 'Temp')
      return path.join(tempDir, 'socket')
    default:
      return path.join(home, '.cache', 'socket')
  }
}

function lazySocketRegistryPath() {
  return path.join(lazySocketAppDataPath(), 'registry')
}

function lazyZshRcPath() {
  return path.join(homedir(), '.zshrc')
}

// Create lazy-loaded constants object
export const lazyConstants = Object.create(null, {
  ...registryConstantsAttribs.getters,
  bashRcPath: {
    get: lazyBashRcPath,
    enumerable: true,
  },
  binCliPath: {
    get: lazyBinCliPath,
    enumerable: true,
  },
  binPath: {
    get: lazyBinPath,
    enumerable: true,
  },
  blessedContribPath: {
    get: lazyBlessedContribPath,
    enumerable: true,
  },
  blessedOptions: {
    get: lazyBlessedOptions,
    enumerable: true,
  },
  blessedPath: {
    get: lazyBlessedPath,
    enumerable: true,
  },
  distBinPath: {
    get: lazyDistBinPath,
    enumerable: true,
  },
  distPackageJsonPath: {
    get: lazyDistPackageJsonPath,
    enumerable: true,
  },
  distPath: {
    value: distPath,
    enumerable: true,
  },
  externalPath: {
    value: externalPath,
    enumerable: true,
  },
  nmBunPath: {
    get: lazyNmBunPath,
    enumerable: true,
  },
  nmNodeGypPath: {
    get: lazyNmNodeGypPath,
    enumerable: true,
  },
  nmNpmPath: {
    get: lazyNmNpmPath,
    enumerable: true,
  },
  nmPnpmPath: {
    get: lazyNmPnpmPath,
    enumerable: true,
  },
  nmYarnPath: {
    get: lazyNmYarnPath,
    enumerable: true,
  },
  packageJsonPath: {
    get: lazyPackageJsonPath,
    enumerable: true,
  },
  rootPath: {
    value: rootPath,
    enumerable: true,
  },
  shadowBinPath: {
    get: lazyShadowBinPath,
    enumerable: true,
  },
  shadowNpmBinPath: {
    get: lazyShadowNpmBinPath,
    enumerable: true,
  },
  shadowNpmInjectPath: {
    get: lazyShadowNpmInjectPath,
    enumerable: true,
  },
  shadowNpxBinPath: {
    get: lazyShadowNpxBinPath,
    enumerable: true,
  },
  shadowPnpmBinPath: {
    get: lazyShadowPnpmBinPath,
    enumerable: true,
  },
  shadowYarnBinPath: {
    get: lazyShadowYarnBinPath,
    enumerable: true,
  },
  socketAppDataPath: {
    get: lazySocketAppDataPath,
    enumerable: true,
  },
  socketCachePath: {
    get: lazySocketCachePath,
    enumerable: true,
  },
  socketRegistryPath: {
    get: lazySocketRegistryPath,
    enumerable: true,
  },
  srcPath: {
    value: srcPath,
    enumerable: true,
  },
  zshRcPath: {
    get: lazyZshRcPath,
    enumerable: true,
  },
})

// Helper for creating require
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
