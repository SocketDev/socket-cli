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
 * pipeline (via socket.yml `projectIgnorePaths`) and the reachability analyzer
 * (via `reachExcludePaths`, ultimately coana's --exclude-dirs). This only
 * translates user-provided --exclude-paths; existing socket.yml
 * `projectIgnorePaths` keep their previous reachability behavior.
 */
export function applyFullExcludePaths({
  cwd,
  reachabilityOptions,
  socketConfig,
  target,
}: ApplyFullExcludePathsOptions): ApplyFullExcludePathsResult {
  const { excludePaths } = reachabilityOptions
  const scaExcludeGlobs = excludePaths.map(excludePathToProjectIgnorePath)
  const coanaExcludeGlobs = projectIgnorePathsToReachExcludePaths(
    excludePaths,
    { cwd, target },
  )
  const effectiveSocketConfig = scaExcludeGlobs.length
    ? {
        ...socketConfig,
        version: socketConfig?.version ?? 2,
        issueRules: socketConfig?.issueRules ?? {},
        githubApp: socketConfig?.githubApp ?? {},
        projectIgnorePaths: [
          ...(socketConfig?.projectIgnorePaths ?? []),
          ...scaExcludeGlobs,
        ],
      }
    : socketConfig
  const mergedReachabilityOptions = excludePaths.length
    ? {
        ...reachabilityOptions,
        reachExcludePaths: [
          ...reachabilityOptions.reachExcludePaths,
          ...coanaExcludeGlobs,
        ],
      }
    : reachabilityOptions

  return { effectiveSocketConfig, mergedReachabilityOptions }
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
 * SCA-side adapter. The user-facing contract for --exclude-paths is anchored
 * micromatch from the Socket scan root, but socket.yml `projectIgnorePaths` is
 * gitignore-style and expands a bare name to a match-anywhere pattern. Append
 * `/**` so the pattern contains a slash and gets anchored by the gitignore
 * translator, matching files under the named directory at the user-specified
 * depth instead of any depth.
 */
export function excludePathToProjectIgnorePath(path: string): string {
  const stripped = stripTrailingSlash(path)
  return stripped.endsWith('/**') ? stripped : `${stripped}/**`
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
