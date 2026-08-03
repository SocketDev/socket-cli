import path from 'node:path'

import { resolveRealBinSync } from '@socketsecurity/lib-stable/bin/resolve'
import { isShadowBinPath } from '@socketsecurity/lib-stable/bin/shadow'
import { whichRealSync } from '@socketsecurity/lib-stable/bin/which'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  createSupportedFilesFilter,
  globWithGitIgnore,
  pathsToGlobPatterns,
} from './glob.mts'

import type { SupportedFiles } from './glob.mts'
import type { SocketYml } from '../socket-yaml.mts'

export type BinPathTrustOptions = {
  cwd?: string | undefined
}

/**
 * First PATH candidate for `binName` that the scanned project cannot control.
 *
 * `whichRealSync` returns every match in PATH order, and the leading matches
 * are the ones a checkout can plant: a `node_modules/.bin` shim installed by
 * its own dependencies, a binary in the directory the CLI was invoked from
 * (which the PATH lookup searches ahead of PATH itself on Windows). Those
 * candidates are skipped, so the first system match wins.
 */
export function findBinPathDetailsSync(
  binName: string,
  options?: BinPathTrustOptions | undefined,
): {
  name: string
  path: string | undefined
} {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as BinPathTrustOptions
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
    if (isProjectControlledBinPath(binPath, { cwd })) {
      continue
    }
    // Unwrapping a `.cmd`/shell wrapper can land on a script the project
    // controls even when the wrapper itself sits in a system directory.
    const realBinPath = resolveRealBinSync(binPath)
    if (isProjectControlledBinPath(realBinPath, { cwd })) {
      continue
    }
    theBinPath = realBinPath
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

/**
 * Whether a binary path is reachable by the project under inspection: a
 * `node_modules/.bin` shadow bin, or anything at or beneath the working
 * directory.
 */
export function isProjectControlledBinPath(
  binPath: string | undefined,
  options?: BinPathTrustOptions | undefined,
): boolean {
  if (!binPath) {
    return false
  }
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as BinPathTrustOptions
  const binDirPath = path.dirname(binPath)
  if (isShadowBinPath(binDirPath)) {
    return true
  }
  const normalizedCwd = normalizePath(path.resolve(cwd))
  const normalizedBinDirPath = normalizePath(path.resolve(binDirPath))
  return (
    normalizedBinDirPath === normalizedCwd ||
    normalizedBinDirPath.startsWith(`${normalizedCwd}/`)
  )
}
