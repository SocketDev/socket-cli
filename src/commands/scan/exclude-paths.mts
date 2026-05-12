import path from 'node:path'

import { InputError } from '../../utils/errors.mts'
import { stripTrailingSlash } from '../../utils/glob.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'

type ApplyFullExcludePathsOptions = {
  cwd: string
  reachabilityOptions: ReachabilityOptions
  target: string
}

type ApplyFullExcludePathsResult = {
  additionalScaIgnores: string[]
  mergedReachabilityOptions: ReachabilityOptions
}

function normalizeProjectIgnorePath(path: string): string {
  return stripTrailingSlash(
    toPosixPath(path.startsWith('/') ? path.slice(1) : path),
  )
}

/**
 * Converts a Socket-scan-root anchored --exclude-paths pattern into the shape
 * Coana expects for the current analysis target. Coana resolves --exclude-dirs
 * relative to the path passed to `coana run`, not relative to this command's
 * cwd. For a root target the pattern can pass through unchanged; for a nested
 * target we strip the target prefix; documented match-anywhere globstar
 * patterns remain meaningful relative to the nested target; and paths outside
 * the target return undefined because Coana cannot exclude directories it is
 * not analyzing.
 */
function pathRelativeToTarget(
  path: string,
  target: string,
): string | undefined {
  const normalized = normalizeProjectIgnorePath(path)
  if (target === '.' || target === '') {
    // Root target: the project root and Coana analysis root are the same directory.
    return normalized
  }
  if (normalized === target) {
    // Whole target excluded: manifest discovery should stop before Coana runs.
    return undefined
  }
  if (normalized.startsWith('**/')) {
    // Match-anywhere glob: keep matching at any depth under the Coana target.
    return normalized
  }
  const targetPrefix = `${target}/`
  if (normalized.startsWith(targetPrefix)) {
    // Nested target: strip the target prefix to make the pattern target-relative.
    return normalized.slice(targetPrefix.length)
  }
  // Outside the target: there is nothing for this Coana run to exclude.
  return undefined
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

/**
 * Derives the two scan-time forms of --exclude-paths: anchored minimatch
 * patterns for SCA manifest discovery, and target-relative paths for Coana's
 * reachability analysis.
 */
export function applyFullExcludePaths({
  cwd,
  reachabilityOptions,
  target,
}: ApplyFullExcludePathsOptions): ApplyFullExcludePathsResult {
  const { excludePaths } = reachabilityOptions
  const additionalScaIgnores = excludePaths.flatMap(excludePathToScanIgnores)
  const coanaExcludeGlobs = projectIgnorePathsToReachExcludePaths(
    excludePaths,
    {
      cwd,
      target,
    },
  )
  const mergedReachabilityOptions = excludePaths.length
    ? {
        ...reachabilityOptions,
        reachExcludePaths: [
          ...reachabilityOptions.reachExcludePaths,
          ...coanaExcludeGlobs,
        ],
      }
    : reachabilityOptions

  return {
    additionalScaIgnores,
    mergedReachabilityOptions,
  }
}

// Patterns that resolve to "exclude the entire scan" or "exclude nothing
// useful" are almost certainly typos. Rejecting them up front beats
// silently producing an empty scan or a no-op exclusion.
const DEGENERATE_EXCLUDE_PATHS = new Set<string>([
  '',
  '.',
  './',
  './**',
  '/',
  '**',
  '/**',
])

/**
 * Validates --exclude-paths entries before they reach either exclusion sink.
 * Rejects gitignore-style negations (coana's --exclude-dirs has no negation
 * form), absolute paths (the flag is scan-root relative), patterns escaping
 * the scan root via `..`, and degenerate match-everything sentinels like `.`,
 * `**`, `/`.
 */
export function assertValidExcludePaths(paths: readonly string[]): void {
  for (const p of paths) {
    if (p.startsWith('!')) {
      throw new InputError(
        `--exclude-paths does not support negation patterns. Got: '${p}'.`,
      )
    }
    const posix = toPosixPath(p).trim()
    if (DEGENERATE_EXCLUDE_PATHS.has(stripTrailingSlash(posix))) {
      throw new InputError(
        `--exclude-paths does not accept match-everything patterns. Got: '${p}'.`,
      )
    }
    if (posix.startsWith('/')) {
      throw new InputError(
        `--exclude-paths must be relative to the scan root. Got absolute path: '${p}'.`,
      )
    }
    if (posix === '..' || posix.startsWith('../') || posix.includes('/../')) {
      throw new InputError(
        `--exclude-paths cannot escape the scan root with '..'. Got: '${p}'.`,
      )
    }
  }
}

/**
 * Expands an anchored-micromatch --exclude-paths entry into the minimatch
 * patterns fast-glob needs to skip both the matched entry itself (file-shaped
 * matches like `packages/stray.json` against `packages/*`) and any subtree
 * underneath it (`packages/a/foo.json`). Returned patterns are ready for
 * fast-glob's `ignore` list — no gitignore translation involved.
 */
export function excludePathToScanIgnores(input: string): string[] {
  const stripped = stripTrailingSlash(toPosixPath(input))
  // User already opted into "match everything under this dir" — one pattern
  // is enough.
  if (stripped.endsWith('/**')) {
    return [stripped]
  }
  // Emit the entry itself (catches file-shaped hits) plus its subtree
  // (catches descendants when the entry resolves to a directory).
  return [stripped, `${stripped}/**`]
}

/**
 * Re-anchors --exclude-paths patterns onto the reachability analysis target.
 * Coana matches --exclude-dirs relative to whichever directory it was invoked
 * on, so when the analysis target is a nested subdirectory, scan-root
 * patterns need their target prefix stripped. Patterns that fall outside the
 * target are dropped — coana cannot exclude what it isn't analyzing. Bails
 * out entirely when any input contains a negation, since coana's --exclude-dirs
 * has no negation form.
 */
export function projectIgnorePathsToReachExcludePaths(
  paths: readonly string[] | undefined,
  options: { cwd: string; target: string },
): string[] {
  if (!Array.isArray(paths) || paths.some(p => p.startsWith('!'))) {
    return []
  }
  const targetPattern = normalizeProjectIgnorePath(
    path.relative(options.cwd, path.resolve(options.cwd, options.target)),
  )
  return paths.flatMap(p => {
    const reachPath = pathRelativeToTarget(p, targetPattern)
    return reachPath === undefined ? [] : [reachPath]
  })
}
