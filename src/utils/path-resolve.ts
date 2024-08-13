import { stat } from 'node:fs/promises'
import path from 'node:path'

import { globby } from 'globby'
import ignore from 'ignore'
// @ts-ignore
import { directories } from 'ignore-by-default'

import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { Options as GlobbyOptions } from 'globby'

// There are a lot of possible folders that we should not be looking in and "ignore-by-default" helps us with defining those
const ignoreByDefault: readonly string[] = directories()

const BASE_GLOBBY_OPTS: GlobbyOptions = {
  absolute: true,
  expandDirectories: false,
  gitignore: true,
  ignore: [...ignoreByDefault.map(item => '**/' + item)],
  markDirectories: true,
  unique: true
}

export async function getPackageFiles(
  cwd: string,
  inputPaths: string[],
  config: SocketYml | undefined,
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data'],
  debugLog: typeof console.error
): Promise<string[]> {
  debugLog(`Globbed resolving ${inputPaths.length} paths:`, inputPaths)

  // TODO: Does not support `~/` paths
  const entries = await globby(inputPaths, {
    ...BASE_GLOBBY_OPTS,
    cwd,
    onlyFiles: false
  })

  debugLog(
    `Globbed resolved ${inputPaths.length} paths to ${entries.length} paths:`,
    entries
  )

  const packageFiles = await mapGlobResultToFiles(entries, supportedFiles)

  debugLog(
    `Mapped ${entries.length} entries to ${packageFiles.length} files:`,
    packageFiles
  )

  const includedPackageFiles = config?.projectIgnorePaths?.length
    ? ignore()
        .add(config.projectIgnorePaths)
        .filter(packageFiles.map(item => path.relative(cwd, item)))
        .map((item: string) => path.resolve(cwd, item))
    : packageFiles

  return includedPackageFiles
}

export async function getPackageFilesFullScans(
  cwd: string,
  inputPaths: string[],
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data'],
  debugLog: typeof console.error
): Promise<string[]> {
  debugLog(`Globbed resolving ${inputPaths.length} paths:`, inputPaths)

  // TODO: Does not support `~/` paths
  const entries = await globby(inputPaths, {
    ...BASE_GLOBBY_OPTS,
    cwd,
    onlyFiles: false
  })

  debugLog(
    `Globbed resolved ${inputPaths.length} paths to ${entries.length} paths:`,
    entries
  )

  const packageFiles = await mapGlobResultToFiles(entries, supportedFiles)

  debugLog(
    `Mapped ${entries.length} entries to ${packageFiles.length} files:`,
    packageFiles
  )

  return packageFiles
}

export async function mapGlobResultToFiles(
  entries: string[],
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data']
): Promise<string[]> {
  const packageFiles = await Promise.all(
    entries.map(entry => mapGlobEntryToFiles(entry, supportedFiles))
  )

  const uniquePackageFiles = [...new Set(packageFiles.flat())]

  return uniquePackageFiles
}

export async function mapGlobEntryToFiles(
  entry: string,
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data']
): Promise<string[]> {
  const jsSupported = supportedFiles['npm'] ?? {}
  const jsLockFilePatterns = Object.values(jsSupported).map(
    p => `**/${(p as { pattern: string }).pattern}`
  )

  const pyFilePatterns = Object.values(supportedFiles['pypi'] ?? {}).map(
    p => `**/${(p as { pattern: string }).pattern}`
  )

  const goSupported = supportedFiles['golang'] ?? {}
  const goSupplementalPatterns = Object.values(goSupported).map(
    p => `**/${(p as { pattern: string }).pattern}`
  )

  const files = await globby(
    [...jsLockFilePatterns, ...pyFilePatterns, ...goSupplementalPatterns],
    {
      ...BASE_GLOBBY_OPTS,
      onlyFiles: true,
      cwd: path.resolve(
        (await stat(entry)).isDirectory() ? entry : path.dirname(entry)
      )
    }
  )

  return files
}