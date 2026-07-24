import path from 'node:path'

import fastGlob from 'fast-glob'
import ignore from 'ignore'
import micromatch from 'micromatch'
import { parse as yamlParse } from 'yaml'

import { isDirSync, safeReadFile } from '@socketsecurity/registry/lib/fs'
import { defaultIgnore } from '@socketsecurity/registry/lib/globs'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { normalizePath } from '@socketsecurity/registry/lib/path'
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
  // Conventional Python virtual environment dir. Arbitrarily-named venvs are
  // detected via their pyvenv.cfg marker during the discovery walk below.
  '.venv',
] as const

const IGNORED_DIR_PATTERNS = IGNORED_DIRS.map(i => `**/${i}`)

// Marker file at the root of every Python virtual environment (stdlib `venv`
// per PEP 405, and virtualenv >= 20). Lets us detect venvs that don't use a
// conventional directory name.
const PYVENV_CFG = 'pyvenv.cfg'

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

type IgnoreMatcher = ReturnType<typeof ignore>

// Whether `targetPath` is ignored by the gitignore matchers on its ancestor
// directories, root to leaf, last match wins. Each matcher tests the path
// relative to its own directory (how git stores patterns); `isDir` appends a
// trailing slash so a directory-only rule like `build/` matches the directory.
// `targetPath` is POSIX, relative to cwd.
function pathIgnoredByChain(
  targetPath: string,
  isDir: boolean,
  matchersByDir: Map<string, IgnoreMatcher[]>,
): boolean {
  let ignored = false
  // Ancestor directories of targetPath: '', then each parent dir prefix.
  const segments = targetPath.split('/')
  segments.pop()
  const dirs = ['']
  let prefix = ''
  for (let i = 0, { length } = segments; i < length; i += 1) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!
    dirs.push(prefix)
  }
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    const matchers = matchersByDir.get(dir)
    if (!matchers) {
      continue
    }
    const relToDir = dir === '' ? targetPath : targetPath.slice(dir.length + 1)
    const probe = isDir ? `${relToDir}/` : relToDir
    for (let j = 0, len = matchers.length; j < len; j += 1) {
      const result = matchers[j]!.test(probe)
      if (result.ignored) {
        ignored = true
      } else if (result.unignored) {
        ignored = false
      }
    }
  }
  return ignored
}

// Whether `relPath` is ignored, honoring git's rule that an excluded directory
// is never descended into: a file is ignored if any ancestor directory is, and a
// deeper `!` cannot re-include a file under an excluded parent. Walks ancestors
// top-down, short-circuiting on the first excluded one. POSIX, relative to cwd.
function isIgnoredAlongChain(
  relPath: string,
  matchersByDir: Map<string, IgnoreMatcher[]>,
): boolean {
  // Outside cwd (a `..` prefix) or empty: outside every gitignore's domain, and
  // the `ignore` package throws on such input, so report not-ignored.
  if (!relPath || relPath === '..' || relPath.startsWith('../')) {
    return false
  }
  const segments = relPath.split('/')
  const last = segments.length - 1
  let prefix = ''
  for (let i = 0; i <= last; i += 1) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!
    if (pathIgnoredByChain(prefix, i < last, matchersByDir)) {
      return true
    }
  }
  return false
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

  // Anchored minimatch patterns for fast-glob: built-in ignored dirs, venv
  // markers, projectIgnorePaths, and every discovered `.gitignore`, translated
  // and anchored from cwd. When no pattern is negated, fast-glob does the whole
  // gitignore match from this set.
  const ignores = new Set<string>(IGNORED_DIR_PATTERNS)

  // CLI-supplied `additionalIgnores` are already anchored minimatch from cwd, so
  // they go straight to fast-glob and never enter the gitignore matchers (whose
  // "match anywhere" semantics would re-interpret a bare `tests` as `**/tests`).
  const cliMinimatchIgnores = additionalIgnores ?? []

  const projectIgnorePaths = socketConfig?.projectIgnorePaths
  const projectIgnoreLines = Array.isArray(projectIgnorePaths)
    ? projectIgnorePaths
    : []
  const projectIgnoreGlobs = projectIgnoreLines.length
    ? ignoreFileLinesToGlobPatterns(
        projectIgnoreLines,
        path.join(cwd, '.gitignore'),
        cwd,
      )
    : []
  for (const pattern of projectIgnoreGlobs) {
    ignores.add(pattern)
  }

  // Raw per-directory `.gitignore` contents from discovery. Matchers are built
  // from these only when a pattern is negated (see below).
  const gitignoreFiles: Array<{ content: string; dir: string }> = []
  // Directory excludes from discovered pyvenv.cfg markers, so virtualenvs with
  // non-conventional names are pruned. Fed to fast-glob's ignore on every path.
  const venvGlobs: string[] = []

  // Discover `.gitignore` files and `pyvenv.cfg` venv markers in one walk,
  // honoring the same dir exclusions as the package walk so an unreadable subtree
  // (EACCES, foreign-uid pgdata, Docker mount) can't abort it. `suppressErrors`
  // skips dirs the user cannot read; negated patterns are dropped here because
  // fast-glob treats `!` ignore entries inconsistently.
  const discoveryStream = fastGlob.globStream(
    ['**/.gitignore', `**/${PYVENV_CFG}`],
    {
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
    },
  )
  for await (const found of transform(
    discoveryStream,
    async (filepath: string) => {
      const dirRel = normalizePath(path.relative(cwd, path.dirname(filepath)))
      if (path.basename(filepath) === PYVENV_CFG) {
        // A pyvenv.cfg sits at the venv root, so exclude the whole directory. An
        // empty dirRel means the scan target itself is a venv root; don't emit
        // `/**`, which would exclude everything the user explicitly targeted.
        return {
          content: '',
          dir: dirRel,
          patterns: dirRel ? [`${dirRel}/**`] : [],
          venv: true,
        }
      }
      const content = (await safeReadFile(filepath)) ?? ''
      return {
        content,
        dir: dirRel,
        patterns: ignoreFileToGlobPatterns(content, filepath, cwd),
        venv: false,
      }
    },
    { concurrency: 8 },
  )) {
    for (const p of found.patterns) {
      ignores.add(p)
    }
    if (found.venv) {
      venvGlobs.push(...found.patterns)
    } else if (found.content) {
      gitignoreFiles.push({ content: found.content, dir: found.dir })
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
    // With a negation, the per-dir matcher chain (below) covers only gitignore
    // and projectIgnore patterns, so fast-glob still prunes the built-in ignored
    // dirs and discovered venvs. Without one, the full anchored set goes to
    // fast-glob, which does the whole match.
    ignore: hasNegatedPattern
      ? [
          ...defaultIgnore,
          ...IGNORED_DIR_PATTERNS,
          ...venvGlobs,
          ...cliMinimatchIgnores,
        ]
      : [...ignores, ...cliMinimatchIgnores].map(stripTrailingSlash),
    ...additionalOptions,
    // Skip dirs the running user cannot read instead of aborting on the first
    // `EACCES`. Pinned after `...additionalOptions` so a caller's options bag
    // cannot flip it off; it is a safety invariant, not a tunable.
    suppressErrors: true,
  } as GlobOptions

  // No negation and no filter: fast-glob's anchored ignore set is authoritative.
  if (!hasNegatedPattern && !filter) {
    return await fastGlob.glob(patterns as string[], globOptions)
  }

  // When a pattern is negated, match each candidate against the gitignore
  // ancestor chain. One matcher per `.gitignore` is built from its raw lines and
  // deduped by content via `igByContent`, keeping compiled-regex memory bounded
  // by the number of DISTINCT `.gitignore` contents, not by file count (a single
  // matcher over every anchored pattern can exhaust V8 code space on big repos).
  let matchersByDir: Map<string, IgnoreMatcher[]> | undefined
  if (hasNegatedPattern) {
    const byDir = new Map<string, IgnoreMatcher[]>()
    const igByContent = new Map<string, IgnoreMatcher>()
    const addMatcher = (dirRel: string, content: string): void => {
      let ig = igByContent.get(content)
      if (!ig) {
        ig = ignore().add(content.split(/\r?\n/))
        igByContent.set(content, ig)
      }
      const existing = byDir.get(dirRel)
      if (existing) {
        existing.push(ig)
      } else {
        byDir.set(dirRel, [ig])
      }
    }
    // projectIgnorePaths act as a root-level gitignore.
    if (projectIgnoreLines.length) {
      addMatcher('', projectIgnoreLines.join('\n'))
    }
    for (let i = 0, { length } = gitignoreFiles; i < length; i += 1) {
      addMatcher(gitignoreFiles[i]!.dir, gitignoreFiles[i]!.content)
    }
    matchersByDir = byDir
  }

  // Stream so memory stays bounded on large monorepos with 100k+ files: the
  // optional caller filter drops non-matches before they accumulate. On the slow
  // path each surviving entry is also re-checked against its gitignore ancestor
  // chain, which carries the full negation support fast-glob lacks.
  const results: string[] = []
  const stream = fastGlob.globStream(
    patterns as string[],
    globOptions,
  ) as AsyncIterable<string>
  for await (const p of stream) {
    if (matchersByDir) {
      // Patterns are forward-slash anchored and tested relative to each
      // gitignore's directory; normalize so a Windows backslash path matches.
      const relPath = normalizePath(
        globOptions.absolute ? path.relative(cwd, p) : p,
      )
      if (isIgnoredAlongChain(relPath, matchersByDir)) {
        continue
      }
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
