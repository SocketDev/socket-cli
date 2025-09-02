import { existsSync } from 'node:fs'
import path from 'node:path'

import which from 'which'

import { isDirSync } from '@socketsecurity/registry/lib/fs'
import { resolveBinPathSync } from '@socketsecurity/registry/lib/npm'

import constants from '../constants.mts'
import {
  filterBySupportedScanFiles,
  globWithGitIgnore,
  pathsToGlobPatterns,
} from './glob.mts'

import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

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
  const { shadowBinPath } = constants
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

export function findNpmDirPathSync(npmBinPath: string): string | undefined {
  const { WIN32 } = constants
  let thePath = npmBinPath
  while (true) {
    const libNmNpmPath = path.join(thePath, 'lib/node_modules/npm')
    // mise, which uses opaque binaries, puts its npm bin in a path like:
    //   /Users/SomeUsername/.local/share/mise/installs/node/vX.X.X/bin/npm.
    // HOWEVER, the location of the npm install is:
    //   /Users/SomeUsername/.local/share/mise/installs/node/vX.X.X/lib/node_modules/npm.
    if (
      // Use existsSync here because statsSync, even with { throwIfNoEntry: false },
      // will throw an ENOTDIR error for paths like ./a-file-that-exists/a-directory-that-does-not.
      // See https://github.com/nodejs/node/issues/56993.
      isDirSync(libNmNpmPath)
    ) {
      thePath = libNmNpmPath
    }
    const hasNmInCurrPath = isDirSync(path.join(thePath, 'node_modules'))
    const hasNmInParentPath =
      !hasNmInCurrPath && isDirSync(path.join(thePath, '../node_modules'))
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
      (hasNmInCurrPath ||
        // In some bespoke cases the node_modules folder is in the parent directory.
        hasNmInParentPath) &&
      // Optimistically look for the default location.
      (path.basename(thePath) === 'npm' ||
        // Chocolatey installs npm bins in the same directory as node bins.
        (WIN32 && existsSync(path.join(thePath, 'npm.cmd'))))
    ) {
      return hasNmInParentPath ? path.dirname(thePath) : thePath
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
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
  options?: PackageFilesForScanOptions | undefined,
): Promise<string[]> {
  const { config: socketConfig, cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as PackageFilesForScanOptions

  const filepaths = await globWithGitIgnore(pathsToGlobPatterns(inputPaths), {
    cwd,
    socketConfig,
  })

  return filterBySupportedScanFiles(filepaths!, supportedFiles)
}
