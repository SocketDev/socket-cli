/** @fileoverview Glob pattern matching utilities for Socket CLI. Provides file searching with gitignore-style exclusions, socket.yml ignore patterns, and package manager specific filtering. Integrates with fast-glob for performance. */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import fastGlob from 'fast-glob'
import ignore from 'ignore'
import micromatch from 'micromatch'
import { parse as yamlParse } from 'yaml'

import { safeReadFile } from '@socketsecurity/registry/lib/fs'
import { defaultIgnore } from '@socketsecurity/registry/lib/globs'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { transform } from '@socketsecurity/registry/lib/streams'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { NODE_MODULES, PNPM } from '../constants.mts'

import type { Agent } from './package-environment.mts'
import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import type { Options as GlobOptions } from 'fast-glob'

const DEFAULT_IGNORE_FOR_GIT_IGNORE = defaultIgnore.filter(
  p => !p.endsWith('.gitignore'),
)

const IGNORED_DIRS = [
  // Taken from ignore-by-default:
  // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
  // Git repository files, see <https://git-scm.com/>
  '.git',
  // Log files emitted by tools such as `tsserver`, see <https://github.com/Microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29>
  '.log',
  // Temporary directory where nyc stores coverage data, see <https://github.com/bcoe/nyc>
  '.nyc_output',
  // Cache folder for node-sass, see <https://github.com/sass/node-sass>
  '.sass-cache',
  // Where node modules are installed when using Yarn, see <https://yarnpkg.com/>
  '.yarn',
  // Where Bower packages are installed, see <http://bower.io/>
  'bower_components',
  // Standard output directory for code coverage reports, see <https://github.com/gotwarlost/istanbul>
  'coverage',
  // Where Node modules are installed, see <https://nodejs.org/>
  NODE_MODULES,
  // Taken from globby:
  // https://github.com/sindresorhus/globby/blob/v14.0.2/ignore.js#L11-L16
  'flow-typed',
] as const

const IGNORED_DIR_PATTERNS = IGNORED_DIRS.map(i => `**/${i}`)

async function getWorkspaceGlobs(
  agent: Agent,
  cwd = process.cwd(),
): Promise<string[]> {
  let workspacePatterns
  if (agent === PNPM) {
    const workspacePath = path.join(cwd, 'pnpm-workspace.yaml')
    const yml = await safeReadFile(workspacePath)
    if (yml) {
      try {
        workspacePatterns = yamlParse(yml.toString())?.packages
      } catch {}
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
  cwd: string,
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
            : path.posix.join(base, pattern),
        ),
      )
    }
  }
  return patterns
}

function ignoreFileToGlobPatterns(
  content: string,
  filepath: string,
  cwd: string,
): string[] {
  return ignoreFileLinesToGlobPatterns(content.split(/\r?\n/), filepath, cwd)
}

// Based on `@eslint/compat` convertIgnorePatternToMinimatch
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
      '$1\\$2',
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

export function filterBySupportedScanFiles(
  filepaths: string[] | readonly string[],
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
): string[] {
  const patterns = getSupportedFilePatterns(supportedFiles)
  return filepaths.filter(p => micromatch.some(p, patterns))
}

export function getSupportedFilePatterns(
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
): string[] {
  const patterns: string[] = []
  for (const key of Object.keys(supportedFiles)) {
    const supported = supportedFiles[key]
    if (supported) {
      patterns.push(...Object.values(supported).map(p => `**/${p.pattern}`))
    }
  }
  return patterns
}

type GlobWithGitIgnoreOptions = GlobOptions & {
  socketConfig?: SocketYml | undefined
}

export async function globWithGitIgnore(
  patterns: string[] | readonly string[],
  options: GlobWithGitIgnoreOptions,
): Promise<string[]> {
  const {
    cwd = process.cwd(),
    socketConfig,
    ...additionalOptions
  } = { __proto__: null, ...options } as GlobWithGitIgnoreOptions

  const ignores = new Set<string>(IGNORED_DIR_PATTERNS)

  const projectIgnorePaths = socketConfig?.projectIgnorePaths
  if (Array.isArray(projectIgnorePaths)) {
    const ignorePatterns = ignoreFileLinesToGlobPatterns(
      projectIgnorePaths,
      path.join(cwd, '.gitignore'),
      cwd,
    )
    for (const pattern of ignorePatterns) {
      ignores.add(pattern)
    }
  }

  const gitIgnoreStream = fastGlob.globStream(['**/.gitignore'], {
    absolute: true,
    cwd,
    ignore: DEFAULT_IGNORE_FOR_GIT_IGNORE,
  })
  for await (const ignorePatterns of transform(
    gitIgnoreStream as AsyncIterable<string>,
    async (filepath: string) =>
      ignoreFileToGlobPatterns(
        String((await safeReadFile(filepath)) ?? ''),
        filepath,
        cwd,
      ),
    { concurrency: 8 },
  )) {
    for (const p of ignorePatterns) {
      ignores.add(p)
    }
  }

  let hasNegatedPattern = false
  for (const p of ignores) {
    if (p.charCodeAt(0) === 33 /*'!'*/) {
      hasNegatedPattern = true
      break
    }
  }

  const globOptions = {
    __proto__: null,
    absolute: true,
    cwd,
    dot: true,
    ignore: (hasNegatedPattern ? defaultIgnore : [...ignores]) as string[],
    ...additionalOptions,
  } as unknown as GlobOptions

  if (!hasNegatedPattern) {
    return await fastGlob.glob(patterns as string[], globOptions)
  }

  // Add support for negated "ignore" patterns which many globbing libraries,
  // including 'fast-glob', 'globby', and 'tinyglobby', lack support for.
  const filtered: string[] = []
  const ig = ignore().add([...ignores])
  const stream = fastGlob.globStream(
    patterns as string[],
    globOptions,
  ) as AsyncIterable<string>
  for await (const p of stream) {
    // Note: the input files must be INSIDE the cwd. If you get strange looking
    // relative path errors here, most likely your path is outside the given cwd.
    const relPath = globOptions.absolute ? path.relative(cwd, p) : p
    if (!ig.ignores(relPath)) {
      filtered.push(p)
    }
  }
  return filtered
}

export async function globWorkspace(
  agent: Agent,
  cwd = process.cwd(),
): Promise<string[]> {
  const workspaceGlobs = await getWorkspaceGlobs(agent, cwd)
  return workspaceGlobs.length
    ? await fastGlob.glob(workspaceGlobs, {
        absolute: true,
        cwd,
        ignore: defaultIgnore as string[],
      } as unknown as GlobOptions)
    : []
}

export function isReportSupportedFile(
  filepath: string,
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
) {
  const patterns = getSupportedFilePatterns(supportedFiles)
  return micromatch.some(filepath, patterns)
}

export function pathsToGlobPatterns(
  paths: string[] | readonly string[],
): string[] {
  // TODO: Does not support `~/` paths.
  return paths.map(p => {
    if (p === '.' || p === './') {
      return '**/*'
    }
    // If path ends with /, treat it as a directory and search recursively
    if (p.endsWith('/')) {
      return `${p}**/*`
    }
    // Check if path exists and is a directory
    try {
      if (existsSync(p) && statSync(p).isDirectory()) {
        return `${p}/**/*`
      }
    } catch {
      // If stat fails, treat as glob pattern
    }
    return p
  })
}
