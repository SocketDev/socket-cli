import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import which from 'which'

const normalize = (value: string) => value.replaceAll('\\', '/')

// Generated shims put their entrypoint near the start. Limit the read because
// the same names can also belong to native executables, such as standalone pnpm.
const SHIM_PREFIX_BYTES = 16 * 1024

function readShimSource(filename: string, requireShebang: boolean) {
  const fd = openSync(filename, 'r')
  try {
    const buffer = Buffer.allocUnsafe(SHIM_PREFIX_BYTES)
    const prefix = buffer.subarray(0, readSync(fd, buffer))
    // Shell shims start with #!. Batch and PowerShell shims have an extension.
    if (
      (requireShebang && (prefix[0] !== 0x23 || prefix[1] !== 0x21)) ||
      prefix.includes(0)
    ) {
      return undefined
    }
    return prefix.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function isVoltaShimPath(binPath: string): boolean {
  const configuredHome = process.env['VOLTA_HOME']
  const voltaHome = configuredHome || path.join(os.homedir(), '.volta')
  return path.dirname(path.resolve(binPath)) === path.resolve(voltaHome, 'bin')
}

function unresolvedBin(binPath: string) {
  return Object.assign(new Error(`not resolved: ${binPath}`), {
    code: 'ENOENT',
  })
}

function resolveShimEntrySync(shimPath: string, relPath: string) {
  const directory = path.dirname(shimPath)
  try {
    return realpathSync.native(normalize(path.resolve(directory, relPath)))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      (code === 'ENOENT' || code === 'ENOTDIR') &&
      relPath === 'pnpm/bin/pnpm.cjs' &&
      path.basename(shimPath) === 'pnpm' &&
      path.basename(directory) === '.bin'
    ) {
      // The setup-pnpm shell shim's package is a sibling of .bin.
      return realpathSync.native(path.resolve(directory, '..', relPath))
    }
    throw error
  }
}

export function resolveBinPathSync(input: string): string {
  const binPath = normalize(input)
  const resolvedBinPath = realpathSync.native(binPath)
  const ext = path.extname(binPath).toLowerCase()
  const basename = path.basename(binPath, path.extname(binPath))
  const isNpmShim = basename === 'npm' || basename === 'npx'
  const isOtherPackageManagerShim = basename === 'pnpm' || basename === 'yarn'
  // Volta dispatches Unix tools by the symlink basename. Keep the pnpm alias
  // so Volta can select the active version instead of spawning volta-shim as pnpm.
  const realBinPath =
    basename === 'pnpm' && isVoltaShimPath(binPath) ? binPath : resolvedBinPath
  if (process.platform === 'win32') {
    if (!['', '.cmd', '.ps1'].includes(ext)) {
      return realBinPath
    }
    // Generic cmd-shim batch wrappers also carry a recognizable entrypoint.
    if (ext !== '.cmd' && !isNpmShim && !isOtherPackageManagerShim) {
      throw unresolvedBin(binPath)
    }
    const source = readShimSource(realBinPath, ext === '')
    if (source === undefined) {
      if (ext === '') {
        return realBinPath
      }
      throw unresolvedBin(binPath)
    }
    let relPath: string | undefined
    if (isNpmShim) {
      const cli = basename === 'npm' ? 'NPM' : 'NPX'
      relPath =
        ext === '.cmd'
          ? new RegExp(`(?<="${cli}_CLI_JS=%~dp0\\\\).*(?=")`).exec(source)?.[0]
          : ext === '.ps1'
            ? new RegExp(`(?<=\\$${cli}_CLI_JS="\\$PSScriptRoot/).*(?=")`).exec(
                source,
              )?.[0]
            : new RegExp(`(?<=${cli}_CLI_JS="\\$CLI_BASEDIR/).*(?=")`).exec(
                source,
              )?.[0]
      const quickPath = path.join(
        path.dirname(realBinPath),
        `node_modules/npm/bin/${basename}-cli.js`,
      )
      if (existsSync(quickPath)) {
        return realpathSync.native(quickPath)
      }
    } else if (isOtherPackageManagerShim) {
      relPath =
        ext === '.cmd'
          ? (/(?:"%~dp0\\node\.exe"\s+"%~dp0\\([^"]+)"|node\s+"%~dp0\\([^"]+)(?="\s+%\*))/
              .exec(source)
              ?.slice(1)
              .find(Boolean) ??
            /(?<="%dp0%\\).*(?=" %\*\r\n)/.exec(source)?.[0])
          : ext === '.ps1'
            ? /(?<="\$basedir\/).*(?=" \$args\n)/.exec(source)?.[0]
            : /(?<="\$basedir\/)[^"]+(?="\s+"\$@")/.exec(source)?.[0]
    } else if (ext === '.cmd') {
      relPath = /(?<="%dp0%\\).*(?=" %\*\r\n)/.exec(source)?.[0]
    }
    if (relPath) {
      return resolveShimEntrySync(realBinPath, relPath)
    }
    throw unresolvedBin(binPath)
  }

  if (ext === '' && (isNpmShim || isOtherPackageManagerShim)) {
    const source = readShimSource(realBinPath, true)
    if (source === undefined) {
      return realBinPath
    }
    let relPath: string | undefined
    if (isNpmShim) {
      relPath =
        basename === 'npm'
          ? /(?<=NPM_CLI_JS="\$CLI_BASEDIR\/).*(?=")/.exec(source)?.[0]
          : /(?<=NPX_CLI_JS="\$CLI_BASEDIR\/).*(?=")/.exec(source)?.[0]
    } else {
      relPath = /(?<="\$basedir\/)[^"]+(?="\s+"\$@")/.exec(source)?.[0]
    }
    if (relPath) {
      return resolveShimEntrySync(realBinPath, relPath)
    }
  }
  return realBinPath
}

type LookupOptions = {
  all?: boolean
  nothrow?: boolean
  path?: string
  pathExt?: string
}

export function whichBin(
  name: string,
  options: LookupOptions & { all: true; nothrow: true },
): Promise<string[] | null>
export function whichBin(
  name: string,
  options: LookupOptions & { nothrow: true; all?: false },
): Promise<string | null>
export function whichBin(name: string, options?: LookupOptions): Promise<string>
export async function whichBin(
  name: string,
  options: LookupOptions = {},
): Promise<string | string[] | null> {
  try {
    const result = await which(name, options as any)
    if (options['all']) {
      const paths = Array.isArray(result) ? result : [result]
      return resolveAllBinPaths(paths)
    }
    return resolveBinPathSync(result as string)
  } catch (error) {
    if (options['nothrow']) {
      return null
    }
    throw error
  }
}

export function whichBinSync(
  name: string,
  options: LookupOptions & { all: true; nothrow: true },
): string[] | null
export function whichBinSync(
  name: string,
  options: LookupOptions & { nothrow: true; all?: false },
): string | null
export function whichBinSync(name: string, options?: LookupOptions): string
export function whichBinSync(
  name: string,
  options: LookupOptions = {},
): string | string[] | null {
  try {
    const result = which.sync(name, options as any)
    if (options['all']) {
      const paths = Array.isArray(result) ? result : [result]
      return resolveAllBinPaths(paths)
    }
    return resolveBinPathSync(result as string)
  } catch (error) {
    if (options['nothrow']) {
      return null
    }
    throw error
  }
}

function resolveAllBinPaths(paths: string[]): string[] {
  const resolved: string[] = []
  let firstError: unknown
  for (const candidate of paths) {
    try {
      resolved.push(resolveBinPathSync(candidate))
    } catch (error) {
      firstError ??= error
    }
  }
  if (resolved.length > 0) {
    return resolved
  }
  throw firstError ?? new Error('No executable paths were resolved')
}
