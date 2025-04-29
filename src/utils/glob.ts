import { promises as fs } from 'node:fs'
import path from 'node:path'

import ignore from 'ignore'
import micromatch from 'micromatch'
import { glob as tinyGlob } from 'tinyglobby'
import { parse as yamlParse } from 'yaml'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import constants from '../constants'
import { safeReadFile } from './fs'

import type { Agent } from './package-environment'
import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { GlobOptions } from 'tinyglobby'

const { NPM, PNPM } = constants

const PNPM_WORKSPACE = `${PNPM}-workspace`

const ignoredDirs = [
  // Taken from ignore-by-default:
  // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
  '.git', // Git repository files, see <https://git-scm.com/>
  '.log', // Log files emitted by tools such as `tsserver`, see <https://github.com/Microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29>
  '.nyc_output', // Temporary directory where nyc stores coverage data, see <https://github.com/bcoe/nyc>
  '.sass-cache', // Cache folder for node-sass, see <https://github.com/sass/node-sass>
  '.yarn', // Where node modules are installed when using Yarn, see <https://yarnpkg.com/>
  'bower_components', // Where Bower packages are installed, see <http://bower.io/>
  'coverage', // Standard output directory for code coverage reports, see <https://github.com/gotwarlost/istanbul>
  'node_modules', // Where Node modules are installed, see <https://nodejs.org/>
  // Taken from globby:
  // https://github.com/sindresorhus/globby/blob/v14.0.2/ignore.js#L11-L16
  'flow-typed'
] as const

const ignoredDirPatterns = ignoredDirs.map(i => `**/${i}`)

async function getWorkspaceGlobs(
  agent: Agent,
  cwd = process.cwd()
): Promise<string[]> {
  let workspacePatterns
  if (agent === PNPM) {
    for (const workspacePath of [
      path.join(cwd, `${PNPM_WORKSPACE}.yaml`),
      path.join(cwd, `${PNPM_WORKSPACE}.yml`)
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const yml = await safeReadFile(workspacePath)
      if (yml) {
        try {
          workspacePatterns = yamlParse(yml)?.packages
        } catch {}
        if (workspacePatterns) {
          break
        }
      }
    }
  } else {
    workspacePatterns = (await readPackageJson(cwd, { throws: false }))?.[
      'workspaces'
    ]
  }
  return Array.isArray(workspacePatterns)
    ? workspacePatterns
        .filter(isNonEmptyString)
        .map(workspacePatternToGlobPattern)
    : []
}

function ignoreFileLinesToGlobPatterns(
  lines: string[] | readonly string[],
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

function workspacePatternToGlobPattern(workspace: string): string {
  const { length } = workspace
  if (!length) {
    return ''
  }
  // If the workspace ends with "/"
  if (workspace.charCodeAt(length - 1) === 47 /*'/'*/) {
    return `${workspace}/*/package.json`
  }
  // If the workspace ends with "/**"
  if (
    workspace.charCodeAt(length - 1) === 42 /*'*'*/ &&
    workspace.charCodeAt(length - 2) === 42 /*'*'*/ &&
    workspace.charCodeAt(length - 3) === 47 /*'/'*/
  ) {
    return `${workspace}/*/**/package.json`
  }
  // Things like "packages/a" or "packages/*"
  return `${workspace}/package.json`
}

export async function filterGlobResultToSupportedFiles(
  entries: string[] | readonly string[],
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

type GlobWithGitIgnoreOptions = GlobOptions & {
  socketConfig?: SocketYml | undefined
}

export async function globWithGitIgnore(
  patterns: string[] | readonly string[],
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
    ...ignoredDirPatterns,
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
  const result = await tinyGlob(patterns as string[], globOptions)
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

export async function globNodeModules(cwd = process.cwd()): Promise<string[]> {
  return await tinyGlob('**/node_modules/**', {
    absolute: true,
    cwd
  })
}

export async function globWorkspace(
  agent: Agent,
  cwd = process.cwd()
): Promise<string[]> {
  const workspaceGlobs = await getWorkspaceGlobs(agent, cwd)
  return workspaceGlobs.length
    ? await tinyGlob(workspaceGlobs, {
        absolute: true,
        cwd,
        ignore: ['**/node_modules/**', '**/bower_components/**']
      })
    : []
}

export function pathsToGlobPatterns(
  paths: string[] | readonly string[]
): string[] {
  // TODO: Does not support `~/` paths.
  return paths.map(p => (p === '.' || p === './' ? '**/*' : p))
}
