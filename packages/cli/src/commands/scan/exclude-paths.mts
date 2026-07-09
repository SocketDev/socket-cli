import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { InputError } from '../../util/error/errors.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { SocketYml } from '../../util/socket-yaml.mts'

export type ApplyFullExcludePathsOptions = {
  cwd: string
  reachabilityOptions: ReachabilityOptions
  socketConfig: SocketYml | undefined
  target: string
}

export type ApplyFullExcludePathsResult = {
  effectiveSocketConfig: SocketYml | undefined
  mergedReachabilityOptions: ReachabilityOptions
}

/**
 * Applies --exclude-paths consistently to SCA manifest discovery and Coana. SCA
 * exclusion always applies when paths are provided. The reachability options
 * are merged unconditionally; callers decide whether to actually run
 * reachability and consume them.
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
    scaExcludeGlobs,
    {
      cwd,
      target,
    },
  )
  const socketConfigReachExcludeGlobs = excludePaths.length
    ? projectIgnorePathsToReachExcludePaths(socketConfig?.projectIgnorePaths, {
        cwd,
        target,
      })
    : []
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
          ...socketConfigReachExcludeGlobs,
          ...reachabilityOptions.reachExcludePaths,
          ...coanaExcludeGlobs,
        ],
      }
    : reachabilityOptions

  return { effectiveSocketConfig, mergedReachabilityOptions }
}

/**
 * Rejects gitignore-style negation patterns for --exclude-paths because the
 * flag is a positive full-exclusion list, not a complete ignore language.
 */
export function assertNoNegationPatterns(paths: readonly string[]): void {
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const excludePath = paths[i]!
    if (excludePath.startsWith('!')) {
      throw new InputError(
        `--exclude-paths does not support negation patterns. Got: '${excludePath}'.`,
      )
    }
  }
}

/**
 * Converts a user-facing full-scan exclude path into the socket.yml
 * projectIgnorePaths shape used by SCA manifest discovery.
 */
export function excludePathToProjectIgnorePath(excludePath: string): string {
  const stripped = stripTrailingSlash(excludePath)
  return stripped.endsWith('/**') ? stripped : `${stripped}/**`
}

export function expandReachExcludePath(reachExcludePath: string): string[] {
  if (reachExcludePath === '**') {
    return ['**']
  }
  const firstSlash = reachExcludePath.indexOf('/')
  const prefix =
    firstSlash === -1 || firstSlash === reachExcludePath.length - 1 ? '**/' : ''
  const normalized = stripTrailingSlash(
    normalizePath(reachExcludePath).startsWith('/')
      ? reachExcludePath.slice(1)
      : reachExcludePath,
  )
  const pattern = `${prefix}${normalized}`
  return pattern.endsWith('/*') || pattern.endsWith('/**')
    ? [pattern]
    : [pattern, `${pattern}/**`]
}

export function normalizeProjectIgnorePath(ignorePath: string): string {
  return stripTrailingSlash(
    toPosixPath(
      normalizePath(ignorePath).startsWith('/')
        ? ignorePath.slice(1)
        : ignorePath,
    ),
  )
}

export function pathRelativeToTarget(
  ignorePath: string,
  target: string,
): string | undefined {
  const normalized = normalizeProjectIgnorePath(ignorePath)
  if (target === '' || target === '.') {
    return normalized
  }

  // Ignore paths outside the analysis target. They still affect SCA manifest
  // discovery through projectIgnorePaths, but Coana cannot exclude directories
  // outside the target it is analyzing.
  if (normalized === target) {
    return '**'
  }
  const targetPrefix = `${target}/`
  if (normalized.startsWith(targetPrefix)) {
    return normalized.slice(targetPrefix.length)
  }
  /* c8 ignore start - unreachable: recursiveTargetPrefix = `${targetPrefix}**\/` so any startsWith(recursiveTargetPrefix) match would have been caught by the startsWith(targetPrefix) check above. */
  const recursiveTargetPrefix = `${targetPrefix}**/`
  if (normalized.startsWith(recursiveTargetPrefix)) {
    return normalized.slice(targetPrefix.length)
  }
  /* c8 ignore stop */
  return undefined
}

export function projectIgnorePathToReachExcludePaths(
  ignorePath: string,
  targetPattern: string,
): string[] {
  const reachPath = pathRelativeToTarget(ignorePath, targetPattern)
  if (!reachPath) {
    return []
  }
  return expandReachExcludePath(reachPath)
}

/**
 * Translates project-root projectIgnorePaths into Coana --exclude-dirs values,
 * which are interpreted relative to the current reachability analysis target.
 */
export function projectIgnorePathsToReachExcludePaths(
  paths: readonly string[] | undefined,
  options: { cwd: string; target: string },
): string[] {
  // GitHub App-style projectIgnorePaths support negation. Coana's
  // --exclude-dirs does not, so keep the existing Coana behavior and let it
  // infer config ignores itself when any negation is present.
  const opts = { __proto__: null, ...options } as typeof options
  if (
    !Array.isArray(paths) ||
    paths.some(ignorePath => ignorePath.includes('!'))
  ) {
    return []
  }

  // projectIgnorePaths are rooted at the project cwd. Coana receives excludes
  // relative to its analysis target, so nested target scans need translation.
  const targetPath = path.isAbsolute(opts.target)
    ? path.relative(opts.cwd, opts.target)
    : opts.target
  const targetPattern = toPosixPath(stripTrailingSlash(targetPath))
  return paths.flatMap(ignorePath =>
    projectIgnorePathToReachExcludePaths(ignorePath, targetPattern),
  )
}

export function stripTrailingSlash(value: string): string {
  // normalizePath collapses separators AND drops any trailing slash, so the
  // normalized form IS the stripped form (root '/' stays '/').
  return value.length > 1 ? normalizePath(value) : value
}

export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/')
}
