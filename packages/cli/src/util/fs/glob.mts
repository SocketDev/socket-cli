import path from 'node:path'

import fastGlob from 'fast-glob'
import ignore from 'ignore'
import micromatch from 'micromatch'
import { parse as yamlParse } from 'yaml'

import { isDirSync } from '@socketsecurity/lib-stable/fs/inspect'
import { safeReadFile } from '@socketsecurity/lib-stable/fs/read-file'
import { defaultIgnore } from '@socketsecurity/lib-stable/globs/defaults'
import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'
import { transform } from '@socketsecurity/lib-stable/streams/transform'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'

import {
  ignoreFileLinesToGlobPatterns,
  ignoreFileToGlobPatterns,
  isIgnoredAlongChain,
  stripTrailingSlashFromIgnorePattern,
} from './glob-ignore.mts'
import { homePath } from '../../constants/paths.mts'
import { NODE_MODULES, PNPM } from '../../constants.mts'

import type { IgnoreMatcher } from './glob-ignore.mts'
import type { Agent } from '../ecosystem/environment.mts'
import type { SocketYml } from '../socket-yaml.mts'
import type { operations } from '@socketsecurity/sdk-stable/types/api'
import type { Options as GlobOptions } from 'fast-glob'

/**
 * The `getSupportedFiles` response payload: ecosystem name -> pattern name ->
 * `{ pattern }` glob. Typed from the SDK's raw OpenAPI schema because the SDK
 * root export's `SocketSdkSuccessResult<'getSupportedFiles'>['data']` resolves
 * to `any` under TypeScript 7's nodenext resolution (extensionless relative
 * imports inside the SDK's dist typings fail to resolve).
 */
export type SupportedFiles =
  operations['getSupportedFiles']['responses']['200']['content']['application/json']

const DEFAULT_IGNORE_FOR_GIT_IGNORE = defaultIgnore.filter(
  (p: string) => !p.endsWith('.gitignore'),
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
// per PEP 405, and virtualenv >= 20). Detects venvs that do not use a
// conventional directory name.
const PYVENV_CFG = 'pyvenv.cfg'

export function createSupportedFilesFilter(
  supportedFiles: SupportedFiles,
): (filepath: string) => boolean {
  const patterns = getSupportedFilePatterns(supportedFiles)
  return (filepath: string) =>
    micromatch.some(filepath, patterns, { dot: true, nocase: true })
}

export function getSupportedFilePatterns(
  supportedFiles: SupportedFiles,
): string[] {
  const patterns: string[] = []
  const keys = Object.keys(supportedFiles)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const supported = supportedFiles[key]
    if (supported) {
      patterns.push(...Object.values(supported).map(p => `**/${p.pattern}`))
    }
  }
  return patterns
}

export async function getWorkspaceGlobs(
  agent: Agent,
  cwd = process.cwd(),
): Promise<string[]> {
  let workspacePatterns: unknown
  if (agent === PNPM) {
    const workspacePath = path.join(cwd, 'pnpm-workspace.yaml')
    const yml = await safeReadFile(workspacePath, { encoding: 'utf8' })
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

export async function globWithGitIgnore(
  patterns: string[] | readonly string[],
  config: GlobWithGitIgnoreOptions,
): Promise<string[]> {
  const {
    cwd = process.cwd(),
    filter,
    socketConfig,
    ...additionalOptions
  } = { __proto__: null, ...config } as GlobWithGitIgnoreOptions

  // Anchored minimatch patterns for fast-glob: built-in ignored dirs, venv
  // markers, projectIgnorePaths, and every discovered `.gitignore`, translated
  // and anchored from cwd. When no pattern is negated, fast-glob does the whole
  // gitignore match from this set.
  const ignores = new Set<string>(IGNORED_DIR_PATTERNS)

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
  for (let i = 0, { length } = projectIgnoreGlobs; i < length; i += 1) {
    const pattern = projectIgnoreGlobs[i]!
    ignores.add(pattern)
  }

  // Raw per-directory `.gitignore` contents from discovery. Matchers are built
  // from these only when a pattern is negated (see below).
  const gitignoreFiles: Array<{ content: string; dir: string }> = []
  // Directory excludes from discovered pyvenv.cfg markers, so virtualenvs with
  // non-conventional names are pruned. Fed to fast-glob's ignore on every path.
  const venvGlobs: string[] = []

  // The discovery walk — .gitignore files plus pyvenv.cfg venv markers — honors
  // the same directory exclusions as the package walk below. Without them an
  // unreadable subtree (a postgres `pgdata` directory owned by another uid, a
  // Docker volume mount) makes fast-glob throw `EACCES: permission denied,
  // scandir` here, before projectIgnorePaths (which is where --exclude-paths
  // lands) reaches the main walk. `suppressErrors` is the backstop: a directory
  // the user cannot read cannot hold manifests they could scan, so skip it
  // instead of aborting the whole run. Negated patterns are dropped — in a
  // discovery walk they can only re-include a subtree, never prevent a crash,
  // and fast-glob handles `!` ignore entries inconsistently. Folding pyvenv.cfg
  // discovery into this walk avoids a second full-tree traversal.
  const discoveryStream = fastGlob.globStream(
    ['**/.gitignore', `**/${PYVENV_CFG}`],
    {
      absolute: true,
      cwd,
      dot: true,
      ignore: [...DEFAULT_IGNORE_FOR_GIT_IGNORE, ...projectIgnoreGlobs]
        .filter(p => p.charCodeAt(0) !== 33 /*'!'*/)
        .map(stripTrailingSlashFromIgnorePattern),
      suppressErrors: true,
    },
  ) as AsyncIterable<string>
  for await (const found of transform(
    discoveryStream,
    async (filepath: string) => {
      // cwd itself normalizes to '.', which is not a path prefix any candidate
      // carries, so flatten it to the empty string the matcher chain keys on.
      const normalizedDir = normalizePath(
        path.relative(cwd, path.dirname(filepath)),
      )
      const dirRel = normalizedDir === '.' ? '' : normalizedDir
      if (path.basename(filepath) === PYVENV_CFG) {
        // A pyvenv.cfg sits at the venv root, so exclude the whole directory.
        // An empty dirRel means the scan target itself is a venv root; emitting
        // `/**` there would exclude everything the user explicitly targeted.
        return {
          content: '',
          dir: dirRel,
          patterns: dirRel ? [`${dirRel}/**`] : [],
          venv: true,
        }
      }
      const content = (await safeReadFile(filepath, { encoding: 'utf8' })) ?? ''
      return {
        content,
        dir: dirRel,
        patterns: ignoreFileToGlobPatterns(content, filepath, cwd),
        venv: false,
      }
    },
    { concurrency: 8 },
  )) {
    const { patterns: foundPatterns } = found
    for (let i = 0, { length } = foundPatterns; i < length; i += 1) {
      const p = foundPatterns[i]!
      ignores.add(p)
    }
    if (found.venv) {
      venvGlobs.push(...foundPatterns)
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
      ? [...defaultIgnore, ...IGNORED_DIR_PATTERNS, ...venvGlobs]
      : [...ignores].map(stripTrailingSlashFromIgnorePattern),
    ...additionalOptions,
    // Skip directories the running user cannot read rather than aborting the
    // whole walk on the first EACCES; the .gitignore discovery walk above
    // carries the full rationale. Pinned after `...additionalOptions` so a
    // caller's options bag cannot flip it back to `false` and re-introduce the
    // crash — this is a safety invariant, not a tunable.
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
        ignore: [...defaultIgnore],
      })
    : []
}

export function isReportSupportedFile(
  filepath: string,
  supportedFiles: SupportedFiles,
) {
  const patterns = getSupportedFilePatterns(supportedFiles)
  return micromatch.some(filepath, patterns, { dot: true, nocase: true })
}

export type GlobWithGitIgnoreOptions = GlobOptions & {
  // Optional filter function to apply during streaming.
  // When provided, only files passing this filter are accumulated.
  // This is critical for memory efficiency when scanning large monorepos.
  filter?: ((filepath: string) => boolean) | undefined
  socketConfig?: SocketYml | undefined
}

export function pathsToGlobPatterns(
  paths: string[] | readonly string[],
  cwd?: string | undefined,
): string[] {
  return paths.map(p => {
    // Convert current directory references to glob patterns.
    if (p === '.' || p === './') {
      return '**/*'
    }
    // Expand tilde to home directory.
    let resolvedPath = p
    if (p.startsWith('~/')) {
      resolvedPath = path.join(homePath, p.slice(2))
    } else if (p === '~') {
      resolvedPath = homePath
    }
    const absolutePath = path.isAbsolute(resolvedPath)
      ? resolvedPath
      : path.resolve(cwd ?? process.cwd(), resolvedPath)
    // If the path is a directory, scan it recursively for all files.
    if (isDirSync(absolutePath)) {
      return `${resolvedPath}/**/*`
    }
    return resolvedPath
  })
}

export function workspacePatternToGlobPattern(workspace: string): string {
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
