import { resolveRealBinSync } from '@socketsecurity/lib-stable/bin/resolve'
import { whichRealSync } from '@socketsecurity/lib-stable/bin/which'

import {
  createSupportedFilesFilter,
  globWithGitIgnore,
  pathsToGlobPatterns,
} from './glob.mts'

import type { SupportedFiles } from './glob.mts'
import type { SocketYml } from '../socket-yaml.mts'

export function findBinPathDetailsSync(binName: string): {
  name: string
  path: string | undefined
} {
  const rawBinPaths =
    whichRealSync(binName, {
      all: true,
      nothrow: true,
    }) ?? []
  // whichRealSync may return a string when only one result is found, even with all: true.
  // This handles both the current published version and future versions.
  const binPaths = Array.isArray(rawBinPaths)
    ? rawBinPaths
    : typeof rawBinPaths === 'string'
      ? [rawBinPaths]
      : []
  let theBinPath: string | undefined
  for (let i = 0, { length } = binPaths; i < length; i += 1) {
    const binPath = binPaths[i]!
    theBinPath = resolveRealBinSync(binPath)
    break
  }
  return { name: binName, path: theBinPath }
}

export type PackageFilesForScanOptions = {
  cwd?: string | undefined
  config?: SocketYml | undefined
}

export async function getPackageFilesForScan(
  inputPaths: string[],
  supportedFiles: SupportedFiles,
  options?: PackageFilesForScanOptions | undefined,
): Promise<string[]> {
  const { config: socketConfig, cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as PackageFilesForScanOptions

  // Apply the supported files filter during streaming to avoid accumulating
  // all files in memory. This is critical for large monorepos with 100k+ files
  // where accumulating all paths before filtering causes OOM errors.
  const filter = createSupportedFilesFilter(supportedFiles)

  return await globWithGitIgnore(
    pathsToGlobPatterns(inputPaths, options?.cwd),
    {
      cwd,
      filter,
      socketConfig,
    },
  )
}
