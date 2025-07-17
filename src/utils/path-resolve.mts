import { existsSync } from 'node:fs'
import path from 'node:path'

import which from 'which'

import { resolveBinPathSync } from '@socketsecurity/registry/lib/npm'

import constants from '../constants.mts'
import { safeStatsSync } from './fs.mts'
import {
  filterGlobResultToSupportedFiles,
  globWithGitIgnore,
  pathsToGlobPatterns,
} from './glob.mts'

import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const { NODE_MODULES, NPM, shadowBinPath } = constants

export function findBinPathDetailsSync(binName: string): {
  name: string
  path: string | undefined
  shadowed: boolean
} {
  const binPaths =
    which.sync(binName, {
      all: true,
      nothrow: true,
    }) ?? []
  let shadowIndex = -1
  let theBinPath: string | undefined
  for (let i = 0, { length } = binPaths; i < length; i += 1) {
    const binPath = binPaths[i]!
    // Skip our bin directory if it's in the front.
    if (path.dirname(binPath) === shadowBinPath) {
      shadowIndex = i
    } else {
      theBinPath = resolveBinPathSync(binPath)
      break
    }
  }
  return { name: binName, path: theBinPath, shadowed: shadowIndex !== -1 }
}

export function findNpmPathSync(npmBinPath: string): string | undefined {
  // Lazily access constants.WIN32.
  const { WIN32 } = constants
  let thePath = npmBinPath
  while (true) {
    const libNmNpmPath = path.join(thePath, 'lib', NODE_MODULES, NPM)
    // mise puts its npm bin in a path like:
    //   /Users/SomeUsername/.local/share/mise/installs/node/vX.X.X/bin/npm.
    // HOWEVER, the location of the npm install is:
    //   /Users/SomeUsername/.local/share/mise/installs/node/vX.X.X/lib/node_modules/npm.
    if (
      // Use existsSync here because statsSync, even with { throwIfNoEntry: false },
      // will throw an ENOTDIR error for paths like ./a-file-that-exists/a-directory-that-does-not.
      // See https://github.com/nodejs/node/issues/56993.
      existsSync(libNmNpmPath) &&
      safeStatsSync(libNmNpmPath)?.isDirectory()
    ) {
      thePath = path.join(libNmNpmPath, NPM)
    }
    const nmPath = path.join(thePath, NODE_MODULES)
    if (
      // npm bin paths may look like:
      //   /usr/local/share/npm/bin/npm
      //   /Users/SomeUsername/.nvm/versions/node/vX.X.X/bin/npm
      //   C:\Users\SomeUsername\AppData\Roaming\npm\bin\npm.cmd
      // OR
      //   C:\Program Files\nodejs\npm.cmd
      //
      // In practically all cases the npm path contains a node_modules folder:
      //   /usr/local/share/npm/bin/npm/node_modules
      //   C:\Program Files\nodejs\node_modules
      existsSync(nmPath) &&
      safeStatsSync(nmPath)?.isDirectory() &&
      // Optimistically look for the default location.
      (path.basename(thePath) === NPM ||
        // Chocolatey installs npm bins in the same directory as node bins.
        (WIN32 && existsSync(path.join(thePath, `${NPM}.cmd`))))
    ) {
      return thePath
    }
    const parent = path.dirname(thePath)
    if (parent === thePath) {
      return undefined
    }
    thePath = parent
  }
}

export type PackageFilesForScanOptions = {
  cwd?: string | undefined
  config?: SocketYml | undefined
}

export async function getPackageFilesForScan(
  inputPaths: string[],
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data'],
  options?: PackageFilesForScanOptions | undefined,
): Promise<string[]> {
  const { config: socketConfig, cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as PackageFilesForScanOptions
  const entries = await globWithGitIgnore(pathsToGlobPatterns(inputPaths), {
    cwd,
    socketConfig,
  })
  return await filterGlobResultToSupportedFiles(entries, supportedFiles)
}
