import path from 'node:path'

import { InputError } from '../../utils/errors.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { SocketYml } from '@socketsecurity/config'

type ApplyFullExcludePathsOptions = {
  cwd: string
  reachabilityOptions: ReachabilityOptions
  socketConfig: SocketYml | undefined
  target: string
}

type ApplyFullExcludePathsResult = {
  additionalScaIgnores: string[]
  effectiveSocketConfig: SocketYml | undefined
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
 * target we strip the target prefix; and for paths outside the target we return
 * undefined because Coana cannot exclude directories it is not analyzing.
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
  const targetPrefix = `${target}/`
  if (normalized.startsWith(targetPrefix)) {
    // Nested target: strip the target prefix to make the pattern target-relative.
    return normalized.slice(targetPrefix.length)
  }
  // Outside the target: there is nothing for this Coana run to exclude.
  return undefined
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

/**
 * Fans --exclude-paths out to both exclusion sinks: the SCA manifest-discovery
 * pipeline (via the fast-glob ignore set) and the reachability analyzer (via
 * `reachExcludePaths`, ultimately coana's --exclude-dirs). The returned
 * `additionalScaIgnores` are already in minimatch form and bypass the
 * gitignore translator. The user's socket.yml is passed through unchanged.
 */
export function applyFullExcludePaths({
  cwd,
  reachabilityOptions,
  socketConfig,
  target,
}: ApplyFullExcludePathsOptions): ApplyFullExcludePathsResult {
  const { excludePaths } = reachabilityOptions
  const additionalScaIgnores = excludePaths.flatMap(excludePathToScanIgnores)
  const coanaExcludeGlobs = projectIgnorePathsToReachExcludePaths(excludePaths, {
    cwd,
    target,
  })
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
    effectiveSocketConfig: socketConfig,
    mergedReachabilityOptions,
  }
}

/**
 * Rejects gitignore-style negation patterns for --exclude-paths. The flag is
 * a positive exclusion list; coana's --exclude-dirs has no negation form, so
 * accepting `!path` would be a lie on the reachability side.
 */
export function assertNoNegationPatterns(paths: readonly string[]): void {
  for (const path of paths) {
    if (path.startsWith('!')) {
      throw new InputError(
        `--exclude-paths does not support negation patterns. Got: '${path}'.`,
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
 * Re-anchors Socket-scan-root patterns onto the reachability analysis target.
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
