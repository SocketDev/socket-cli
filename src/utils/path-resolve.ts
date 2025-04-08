import { existsSync, promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import ignore from 'ignore'
import micromatch from 'micromatch'
import { glob as tinyGlob } from 'tinyglobby'
import which from 'which'

import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
import { resolveBinPath } from '@socketsecurity/registry/lib/npm'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { directoryPatterns } from './ignore-by-default'
import constants from '../constants'

import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { GlobOptions } from 'tinyglobby'

type GlobWithGitIgnoreOptions = GlobOptions & {
  socketConfig?: SocketYml | undefined
}

const { NODE_MODULES, NPM, shadowBinPath } = constants

async function filterGlobResultToSupportedFiles(
  entries: string[],
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data']
): Promise<string[]> {
  const patterns = ['golang', NPM, 'maven', 'pypi', 'gem', 'nuget'].reduce(
    (r: string[], n: string) => {
      const supported = supportedFiles[n]
      r.push(
        ...(supported
          ? Object.values(supported).map(p => `**/${p.pattern}`)
          : [])
      )
      return r
    },
    []
  )
  return entries.filter(p => micromatch.some(p, patterns))
}

async function globWithGitIgnore(
  patterns: string[],
  options: GlobWithGitIgnoreOptions
) {
  const {
    cwd = process.cwd(),
    socketConfig,
    ...additionalOptions
  } = { __proto__: null, ...options } as GlobWithGitIgnoreOptions
  const projectIgnorePaths = socketConfig?.projectIgnorePaths
  const ignoreFiles = await tinyGlob(['**/.gitignore'], {
    absolute: true,
    cwd,
    expandDirectories: true
  })
  const ignores = [
    ...directoryPatterns(),
    ...(Array.isArray(projectIgnorePaths)
      ? ignoreFileLinesToGlobPatterns(
          projectIgnorePaths,
          path.join(cwd, '.gitignore'),
          cwd
        )
      : []),
    ...(
      await Promise.all(
        ignoreFiles.map(async filepath =>
          ignoreFileToGlobPatterns(
            await fs.readFile(filepath, 'utf8'),
            filepath,
            cwd
          )
        )
      )
    ).flat()
  ]
  const hasNegatedPattern = ignores.some(p => p.charCodeAt(0) === 33 /*'!'*/)
  const globOptions = {
    absolute: true,
    cwd,
    expandDirectories: false,
    ignore: hasNegatedPattern ? [] : ignores,
    ...additionalOptions
  }
  const result = await tinyGlob(patterns, globOptions)
  if (!hasNegatedPattern) {
    return result
  }
  const { absolute } = globOptions

  // Note: the input files must be INSIDE the cwd. If you get strange looking
  // relative path errors here, most likely your path is outside the given cwd.
  const filtered = ignore()
    .add(ignores)
    .filter(absolute ? result.map(p => path.relative(cwd, p)) : result)
  return absolute ? filtered.map(p => path.resolve(cwd, p)) : filtered
}

function ignoreFileLinesToGlobPatterns(
  lines: string[],
  filepath: string,
  cwd: string
): string[] {
  const base = path.relative(cwd, path.dirname(filepath)).replace(/\\/g, '/')
  const patterns = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const pattern = lines[i]!.trim()
    if (pattern.length > 0 && pattern.charCodeAt(0) !== 35 /*'#'*/) {
      patterns.push(
        ignorePatternToMinimatch(
          pattern.length && pattern.charCodeAt(0) === 33 /*'!'*/
            ? `!${path.posix.join(base, pattern.slice(1))}`
            : path.posix.join(base, pattern)
        )
      )
    }
  }
  return patterns
}

function ignoreFileToGlobPatterns(
  content: string,
  filepath: string,
  cwd: string
): string[] {
  return ignoreFileLinesToGlobPatterns(content.split(/\r?\n/), filepath, cwd)
}

// Based on `@eslint/compat` convertIgnorePatternToMinimatch.
// Apache v2.0 licensed
// Copyright Nicholas C. Zakas
// https://github.com/eslint/rewrite/blob/compat-v1.2.1/packages/compat/src/ignore-file.js#L28
function ignorePatternToMinimatch(pattern: string): string {
  const isNegated = pattern.startsWith('!')
  const negatedPrefix = isNegated ? '!' : ''
  const patternToTest = (isNegated ? pattern.slice(1) : pattern).trimEnd()
  // Special cases.
  if (
    patternToTest === '' ||
    patternToTest === '**' ||
    patternToTest === '/**' ||
    patternToTest === '**'
  ) {
    return `${negatedPrefix}${patternToTest}`
  }
  const firstIndexOfSlash = patternToTest.indexOf('/')
  const matchEverywherePrefix =
    firstIndexOfSlash === -1 || firstIndexOfSlash === patternToTest.length - 1
      ? '**/'
      : ''
  const patternWithoutLeadingSlash =
    firstIndexOfSlash === 0 ? patternToTest.slice(1) : patternToTest
  // Escape `{` and `(` because in gitignore patterns they are just
  // literal characters without any specific syntactic meaning,
  // while in minimatch patterns they can form brace expansion or extglob syntax.
  //
  // For example, gitignore pattern `src/{a,b}.js` ignores file `src/{a,b}.js`.
  // But, the same minimatch pattern `src/{a,b}.js` ignores files `src/a.js` and `src/b.js`.
  // Minimatch pattern `src/\{a,b}.js` is equivalent to gitignore pattern `src/{a,b}.js`.
  const escapedPatternWithoutLeadingSlash =
    patternWithoutLeadingSlash.replaceAll(
      /(?=((?:\\.|[^{(])*))\1([{(])/guy,
      '$1\\$2'
    )
  const matchInsideSuffix = patternToTest.endsWith('/**') ? '/*' : ''
  return `${negatedPrefix}${matchEverywherePrefix}${escapedPatternWithoutLeadingSlash}${matchInsideSuffix}`
}

function pathsToPatterns(paths: string[] | readonly string[]): string[] {
  // TODO: Does not support `~/` paths.
  return paths.map(p => (p === '.' || p === './' ? '**/*' : p))
}

export function findBinPathDetailsSync(binName: string): {
  name: string
  path: string | undefined
  shadowed: boolean
} {
  const binPaths =
    which.sync(binName, {
      all: true,
      nothrow: true
    }) ?? []
  let shadowIndex = -1
  let theBinPath: string | undefined
  for (let i = 0, { length } = binPaths; i < length; i += 1) {
    const binPath = binPaths[i]!
    // Skip our bin directory if it's in the front.
    if (path.dirname(binPath) === shadowBinPath) {
      shadowIndex = i
    } else {
      theBinPath = resolveBinPath(binPath)
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
      statSync(libNmNpmPath, { throwIfNoEntry: false })?.isDirectory()
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
      statSync(nmPath, { throwIfNoEntry: false })?.isDirectory() &&
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

export async function getPackageFilesForScan(
  cwd: string,
  inputPaths: string[],
  supportedFiles: SocketSdkReturnType<'getReportSupportedFiles'>['data'],
  config?: SocketYml | undefined
): Promise<string[]> {
  debugLog(
    `getPackageFilesForScan: resolving ${inputPaths.length} paths:\n`,
    inputPaths
  )

  // Lazily access constants.spinner.
  const { spinner } = constants

  const patterns = pathsToPatterns(inputPaths)

  spinner.start('Searching for local files to include in scan...')

  const entries = await globWithGitIgnore(patterns, {
    cwd,
    socketConfig: config
  })

  if (isDebug()) {
    spinner.stop()
    debugLog(
      `Resolved ${inputPaths.length} paths to ${entries.length} local paths:\n`,
      entries
    )
    spinner.start('Searching for files now...')
  } else {
    spinner.start(
      `Resolved ${inputPaths.length} paths to ${entries.length} local paths, searching for files now...`
    )
  }

  const packageFiles = await filterGlobResultToSupportedFiles(
    entries,
    supportedFiles
  )

  spinner.successAndStop(
    `Found ${packageFiles.length} local ${pluralize('file', packageFiles.length)}`
  )
  debugLog('Absolute paths:\n', packageFiles)

  return packageFiles
}
