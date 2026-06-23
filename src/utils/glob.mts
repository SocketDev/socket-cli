import path from 'node:path'

import fastGlob from 'fast-glob'
import ignore from 'ignore'
import micromatch from 'micromatch'
import { parse as yamlParse } from 'yaml'

import { isDirSync, safeReadFile } from '@socketsecurity/registry/lib/fs'
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

export const IGNORED_DIRS = [
  // Taken from ignore-by-default:
  // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
  '.git', // Git repository files, see <https://git-scm.com/>
  '.log', // Log files emitted by tools such as `tsserver`, see <https://github.com/Microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29>
  '.nyc_output', // Temporary directory where nyc stores coverage data, see <https://github.com/bcoe/nyc>
  '.sass-cache', // Cache folder for node-sass, see <https://github.com/sass/node-sass>
  '.yarn', // Where node modules are installed when using Yarn, see <https://yarnpkg.com/>
  'bower_components', // Where Bower packages are installed, see <http://bower.io/>
  'coverage', // Standard output directory for code coverage reports, see <https://github.com/gotwarlost/istanbul>
  NODE_MODULES, // Where Node modules are installed, see <https://nodejs.org/>
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
        workspacePatterns = yamlParse(yml)?.packages
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
      '$1\\$2',
    )
  const matchInsideSuffix = patternToTest.endsWith('/**') ? '/*' : ''
  return `${negatedPrefix}${matchEverywherePrefix}${escapedPatternWithoutLeadingSlash}${matchInsideSuffix}`
}

// fast-glob silently discards `ignore` entries that end in `/` (it
// treats them as literal directory paths, not glob patterns). The
// gitignore convention of writing directory entries as `dist/` lands
// here as `**/dist/` after `ignorePatternToMinimatch`, which fast-glob
// then drops — defeating the entire ignore. Strip the trailing slash
// so fast-glob actually honors the pattern.
export function stripTrailingSlash(pattern: string): string {
  if (
    pattern.length > 1 &&
    pattern.charCodeAt(pattern.length - 1) === 47 /*'/'*/
  ) {
    return pattern.slice(0, -1)
  }
  return pattern
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
  return filepaths.filter(p =>
    micromatch.some(p, patterns, { dot: true, nocase: true }),
  )
}

export function createSupportedFilesFilter(
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
): (filepath: string) => boolean {
  const patterns = getSupportedFilePatterns(supportedFiles)
  return (filepath: string) =>
    micromatch.some(filepath, patterns, { dot: true, nocase: true })
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
  // Already-anchored minimatch patterns merged into fast-glob's `ignore`
  // option in every code path. These bypass the gitignore translator and
  // the `ignore` package matcher entirely; use this channel for CLI flags
  // whose contract is anchored micromatch from `cwd` (e.g. --exclude-paths).
  // Patterns in `socketConfig.projectIgnorePaths` and discovered `.gitignore`
  // files take the other channel: they're gitignore-translated first.
  additionalIgnores?: readonly string[] | undefined
  // Optional filter function to apply during streaming.
  // When provided, only files passing this filter are accumulated.
  // This is critical for memory efficiency when scanning large monorepos.
  filter?: ((filepath: string) => boolean) | undefined
  socketConfig?: SocketYml | undefined
}

export async function globWithGitIgnore(
  patterns: string[] | readonly string[],
  options: GlobWithGitIgnoreOptions,
): Promise<string[]> {
  const {
    additionalIgnores,
    cwd = process.cwd(),
    filter,
    socketConfig,
    ...additionalOptions
  } = { __proto__: null, ...options } as GlobWithGitIgnoreOptions

  const ignores = new Set<string>(IGNORED_DIR_PATTERNS)

  // CLI-supplied `additionalIgnores` are already anchored minimatch — they
  // must not pass through the `ignore` package (whose gitignore "match
  // anywhere" semantics would re-interpret a bare `tests` to match
  // `subdir/tests/foo.json`). Keep them in fast-glob's ignore list across
  // both paths; only gitignore-translated entries go into the `ig` matcher.
  const cliMinimatchIgnores = additionalIgnores ?? []

  const projectIgnorePaths = socketConfig?.projectIgnorePaths
  const projectIgnoreGlobs = Array.isArray(projectIgnorePaths)
    ? ignoreFileLinesToGlobPatterns(
        projectIgnorePaths,
        path.join(cwd, '.gitignore'),
        cwd,
      )
    : []
  for (const pattern of projectIgnoreGlobs) {
    ignores.add(pattern)
  }

  // The .gitignore discovery walk has to honor the same directory exclusions
  // as the package walk below. Otherwise an unreadable subtree (e.g. a
  // postgres `pgdata` dir owned by another uid, or a Docker volume mount) makes
  // fast-glob throw `EACCES: permission denied, scandir` *here* — before
  // --exclude-paths (`cliMinimatchIgnores`) or projectIgnorePaths are ever
  // applied to the main walk, which is why excluding the path did not help.
  // `suppressErrors` is the backstop: a directory the user simply cannot read
  // cannot contain manifests they could scan anyway, so skip it instead of
  // aborting the whole `socket fix` / `socket scan` run. Negated patterns are
  // dropped — for a discovery walk they could only re-include a subtree (never
  // prevent a crash), and fast-glob treats `!` ignore entries inconsistently.
  const gitIgnoreStream = fastGlob.globStream(['**/.gitignore'], {
    absolute: true,
    cwd,
    dot: true,
    ignore: [
      ...DEFAULT_IGNORE_FOR_GIT_IGNORE,
      ...projectIgnoreGlobs,
      ...cliMinimatchIgnores,
    ]
      .filter(p => p.charCodeAt(0) !== 33 /*'!'*/)
      .map(stripTrailingSlash),
    suppressErrors: true,
  })
  for await (const ignorePatterns of transform(
    gitIgnoreStream,
    async (filepath: string) =>
      ignoreFileToGlobPatterns(
        (await safeReadFile(filepath)) ?? '',
        filepath,
        cwd,
      ),
    { concurrency: 8 },
  )) {
    for (const p of ignorePatterns) {
      ignores.add(p)
    }
  }

  // Match every gitignore-derived pattern through a single reused `ignore`
  // instance instead of handing the whole set to fast-glob's native `ignore`
  // option. fast-glob re-compiles and re-tests its entire ignore array inside
  // each directory scan (`node::fs::AfterScanDir`), so a large monorepo whose
  // nested `.gitignore` files union to tens of thousands of patterns aborts with
  // `CALL_AND_RETRY_LAST … heap out of memory`. Raising `--max-old-space-size`
  // does not reliably help: much of the cost is regex executable code in V8 code
  // space rather than the data heap. The `ignore` package compiles each rule
  // once and memoizes it, so the cost scales with the pattern count rather than
  // being multiplied by the number of directories walked. fast-glob
  // keeps only the small, bounded set it needs to PRUNE directories during the
  // walk (`defaultIgnore`, which already excludes node_modules and .git, plus
  // the anchored CLI minimatch ignores); the high-cardinality gitignore set is
  // applied per streamed entry by `ig` below. The `ignore` package also honors
  // negated re-includes, which fast-glob, globby, and tinyglobby cannot express.
  // The negated-pattern path already worked this way; routing both cases through
  // it removes the asymmetry that left the common, non-negated case crashing on
  // large repos.
  const ig = ignore().add([...ignores])

  const globOptions = {
    __proto__: null,
    absolute: true,
    cwd,
    dot: true,
    ignore: [...defaultIgnore, ...cliMinimatchIgnores],
    ...additionalOptions,
    // Skip directories the running user cannot read rather than aborting the
    // whole walk on the first `EACCES` (see the .gitignore discovery walk
    // above for the full rationale). Pinned after `...additionalOptions` so a
    // caller's options bag cannot accidentally flip it back to `false` and
    // re-introduce the crash — `suppressErrors` is a safety invariant here, not
    // a tunable.
    suppressErrors: true,
  } as GlobOptions

  // Stream results so memory stays bounded on large monorepos with 100k+ files:
  // `ig` applies the gitignore matching per entry and the optional caller filter
  // (e.g. manifest files only) drops non-matches before they accumulate, instead
  // of collecting every path and filtering afterward.
  const results: string[] = []
  const stream = fastGlob.globStream(
    patterns as string[],
    globOptions,
  ) as AsyncIterable<string>
  for await (const p of stream) {
    // Note: the input files must be INSIDE the cwd. If you get strange looking
    // relative path errors here, most likely your path is outside the given cwd.
    const relPath = globOptions.absolute ? path.relative(cwd, p) : p
    if (ig.ignores(relPath)) {
      continue
    }
    if (filter && !filter(p)) {
      continue
    }
    results.push(p)
  }
  return results
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
        dot: true,
        ignore: defaultIgnore,
      })
    : []
}

export function isReportSupportedFile(
  filepath: string,
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
) {
  const patterns = getSupportedFilePatterns(supportedFiles)
  return micromatch.some(filepath, patterns, { dot: true, nocase: true })
}

export function pathsToGlobPatterns(
  paths: string[] | readonly string[],
  cwd?: string | undefined,
): string[] {
  // TODO: Does not support `~/` paths.
  return paths.map(p => {
    // Convert current directory references to glob patterns.
    if (p === '.' || p === './') {
      return '**/*'
    }
    const absolutePath = path.isAbsolute(p)
      ? p
      : path.resolve(cwd ?? process.cwd(), p)
    // If the path is a directory, scan it recursively for all files.
    if (isDirSync(absolutePath)) {
      return `${p}/**/*`
    }
    return p
  })
}
