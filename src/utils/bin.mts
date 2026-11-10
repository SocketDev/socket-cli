/** Minimal binary lookup/resolution adapted from @socketsecurity/registry 1.1.17 lib/bin.js (MIT). */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

import which from 'which'

const normalize = (value: string) => value.replaceAll('\\', '/')

export function resolveBinPathSync(input: string): string {
  const binPath = normalize(input)
  const realBinPath = realpathSync.native(binPath)
  const ext = path.extname(binPath).toLowerCase()
  const basename = path.basename(binPath, path.extname(binPath))
  if (process.platform === 'win32') {
    if (!['', '.cmd', '.ps1'].includes(ext)) {
      return realBinPath
    }
    const source = readFileSync(realBinPath, 'utf8')
    let relPath: string | undefined
    if (basename === 'npm' || basename === 'npx') {
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
    } else if (basename === 'pnpm' || basename === 'yarn') {
      relPath =
        ext === '.cmd'
          ? (/(?<=node\s+")%~dp0\\([^"]+)(?="\s+%\*)/.exec(source)?.[1] ??
            /(?<="%dp0%\\).*(?=" %\*\r\n)/.exec(source)?.[0])
          : ext === '.ps1'
            ? /(?<="\$basedir\/).*(?=" \$args\n)/.exec(source)?.[0]
            : /(?<="\$basedir\/)[^"]+(?="\s+"\$@")/.exec(source)?.[0]
    } else if (ext === '.cmd') {
      relPath = /(?<="%dp0%\\).*(?=" %\*\r\n)/.exec(source)?.[0]
    }
    if (relPath) {
      return realpathSync.native(
        normalize(path.resolve(path.dirname(realBinPath), relPath)),
      )
    }
    throw Object.assign(new Error(`not resolved: ${binPath}`), {
      code: 'ENOENT',
    })
  }

  if (ext === '') {
    const source = readFileSync(realBinPath, 'utf8')
    let relPath: string | undefined
    if (basename === 'npm' || basename === 'npx') {
      relPath =
        basename === 'npm'
          ? /(?<=NPM_CLI_JS="\$CLI_BASEDIR\/).*(?=")/.exec(source)?.[0]
          : /(?<=NPX_CLI_JS="\$CLI_BASEDIR\/).*(?=")/.exec(source)?.[0]
    } else if (basename === 'pnpm' || basename === 'yarn') {
      relPath = /(?<="\$basedir\/)[^"]+(?="\s+"\$@")/.exec(source)?.[0]
    }
    if (relPath) {
      return realpathSync.native(
        normalize(path.resolve(path.dirname(realBinPath), relPath)),
      )
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
      return paths.map(resolveBinPathSync)
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
      return paths.map(resolveBinPathSync)
    }
    return resolveBinPathSync(result as string)
  } catch (error) {
    if (options['nothrow']) {
      return null
    }
    throw error
  }
}
