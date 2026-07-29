/**
 * Trusted PATH resolution for bootstrap.
 *
 * Bootstrap runs system tools while the working directory is a repository
 * checkout the CLI did not author, and a bare command name is resolved by a
 * lookup that prepends `process.cwd()` ahead of every PATH entry on Windows —
 * a checkout shipping `npm.cmd` in its root wins over the system install.
 * Bootstrap therefore resolves its tools here, against a PATH stripped of
 * relative entries, entries under the working directory, and `node_modules/.bin`
 * shadow directories, and spawns the absolute result.
 *
 * This file is bundled into bootstrap, not imported at runtime, so it stays
 * small and free of CLI imports.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const SHADOW_BIN_SEGMENT = 'node_modules/.bin'

const WINDOWS_DEFAULT_PATH_EXT = '.COM;.EXE;.BAT;.CMD'

// Windows scripts are launched by cmd.exe, not by CreateProcess.
const WINDOWS_SCRIPT_EXTS = ['.bat', '.cmd', '.ps1']

export type SystemBinPathOptions = {
  /**
   * Directory treated as untrusted. Defaults to the working directory.
   */
  cwd?: string | undefined
  /**
   * Windows executable suffix list. Defaults to `PATHEXT`.
   */
  pathExt?: string | undefined
  /**
   * PATH value to search. Defaults to `PATH`.
   */
  pathValue?: string | undefined
  /**
   * Treat the host as Windows. Defaults to the real platform; an explicit
   * value keeps the suffix table exercisable from a POSIX test run.
   */
  windows?: boolean | undefined
}

/**
 * PATH directories bootstrap is willing to search.
 *
 * A relative entry resolves against the untrusted working directory, an entry
 * under that directory is repository-controlled, and a `node_modules/.bin`
 * entry is a shadow bin the checkout populates through its own dependencies.
 * All three are dropped.
 */
export function getTrustedBinSearchPaths(
  options?: SystemBinPathOptions | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as SystemBinPathOptions
  const {
    cwd = process.cwd(),
    pathValue = process.env['PATH'] ?? '',
    windows = process.platform === 'win32',
  } = opts
  const delimiter = windows ? ';' : ':'
  const comparableCwd = toComparableBinPath(cwd, opts)
  const searchPaths: string[] = []
  const rawEntries = pathValue.split(delimiter)
  for (let i = 0, { length } = rawEntries; i < length; i += 1) {
    const entry = rawEntries[i]!.trim()
    if (!entry || !path.isAbsolute(entry)) {
      continue
    }
    const comparable = toComparableBinPath(entry, opts)
    if (
      comparable.includes(SHADOW_BIN_SEGMENT) ||
      comparable === comparableCwd ||
      comparable.startsWith(`${comparableCwd}/`)
    ) {
      continue
    }
    searchPaths.push(entry)
  }
  return searchPaths
}

/**
 * Whether a resolved binary is a Windows script that only a shell can launch.
 */
export function needsShellForBinPath(binPath: string): boolean {
  const lowered = binPath.toLowerCase()
  return WINDOWS_SCRIPT_EXTS.some(ext => lowered.endsWith(ext))
}

/**
 * Absolute path of `binName` in the trusted search paths, or undefined when no
 * trusted directory holds it.
 */
export function resolveSystemBinPath(
  binName: string,
  options?: SystemBinPathOptions | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options } as SystemBinPathOptions
  const { windows = process.platform === 'win32' } = opts
  const pathExt =
    opts.pathExt ?? process.env['PATHEXT'] ?? WINDOWS_DEFAULT_PATH_EXT
  const suffixes = windows
    ? pathExt.split(';').filter(ext => ext.length > 0)
    : ['']
  const searchPaths = getTrustedBinSearchPaths(opts)
  for (let i = 0, { length } = searchPaths; i < length; i += 1) {
    const searchPath = searchPaths[i]!
    for (let j = 0, { length: suffixCount } = suffixes; j < suffixCount; j += 1) {
      const candidate = path.join(searchPath, `${binName}${suffixes[j]!}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * Normalized form used for every path comparison, case-folded on Windows.
 */
export function toComparableBinPath(
  binPath: string,
  options?: SystemBinPathOptions | undefined,
): string {
  const { windows = process.platform === 'win32' } = {
    __proto__: null,
    ...options,
  } as SystemBinPathOptions
  const normalized = normalizePath(binPath)
  return windows ? normalized.toLowerCase() : normalized
}
