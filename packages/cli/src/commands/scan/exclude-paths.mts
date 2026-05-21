import path from 'node:path'

import { InputError } from '../../util/error/errors.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { SocketYml } from '../../util/socket-yaml.mts'

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
    const path = paths[i]!
    if (path.startsWith('!')) {
      throw new InputError(
        `--exclude-paths does not support negation patterns. Got: '${path}'.`,
      )
    }
  }
}

/**
 * Converts a user-facing full-scan exclude path into the socket.yml
 * projectIgnorePaths shape used by SCA manifest discovery.
 */
export function excludePathToProjectIgnorePath(path: string): string {
  const stripped = stripTrailingSlash(path)
  return stripped.endsWith('/**') ? stripped : `${stripped}/**`
}

export function expandReachExcludePath(path: string): string[] {
  if (path === '**') {
    return ['**']
  }
  const firstSlash = path.indexOf('/')
  const prefix =
    firstSlash === -1 || firstSlash === path.length - 1 ? '**/' : ''
  const normalized = stripTrailingSlash(
    path.startsWith('/') ? path.slice(1) : path,
  )
  const pattern = `${prefix}${normalized}`
  return pattern.endsWith('/*') || pattern.endsWith('/**')
    ? [pattern]
    : [pattern, `${pattern}/**`]
}

/**
 * Normalizes a reachability exclude path to a recursive directory glob without
 * changing explicit one-level or recursive glob suffixes.
 */
export function normalizeExcludePath(path: string): string {
  const stripped = stripTrailingSlash(path)
  return stripped.endsWith('/*') || stripped.endsWith('/**')
    ? stripped
    : `${stripped}/**`
}

function normalizeProjectIgnorePath(path: string): string {
  return stripTrailingSlash(
    toPosixPath(path.startsWith('/') ? path.slice(1) : path),
  )
}

export function pathRelativeToTarget(
  path: string,
  target: string,
): string | undefined {
  const normalized = normalizeProjectIgnorePath(path)
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

function projectIgnorePathToReachExcludePaths(
  path: string,
  targetPattern: string,
): string[] {
  const reachPath = pathRelativeToTarget(path, targetPattern)
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
  if (!Array.isArray(paths) || paths.some(path => path.includes('!'))) {
    return []
  }

  // projectIgnorePaths are rooted at the project cwd. Coana receives excludes
  // relative to its analysis target, so nested target scans need translation.
  const targetPath = path.isAbsolute(options.target)
    ? path.relative(options.cwd, options.target)
    : options.target
  const targetPattern = toPosixPath(stripTrailingSlash(targetPath))
  return paths.flatMap(path =>
    projectIgnorePathToReachExcludePaths(path, targetPattern),
  )
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}
