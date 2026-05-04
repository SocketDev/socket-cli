import path from 'node:path'

import { InputError } from '../../utils/errors.mts'

export function excludePathToProjectIgnorePath(path: string): string {
  const stripped = stripTrailingSlash(path)
  return stripped.endsWith('/**') ? stripped : `${stripped}/**`
}

export function assertNoNegationPatterns(paths: readonly string[]): void {
  for (const path of paths) {
    if (path.startsWith('!')) {
      throw new InputError(
        `--exclude-paths does not support negation patterns. Got: '${path}'.`,
      )
    }
  }
}

export function normalizeExcludePath(path: string): string {
  const stripped = stripTrailingSlash(path)
  return stripped.endsWith('/*') || stripped.endsWith('/**')
    ? stripped
    : `${stripped}/**`
}

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

function expandReachExcludePath(path: string): string[] {
  if (path === '**') {
    return ['**']
  }
  const firstSlash = path.indexOf('/')
  const prefix = firstSlash === -1 || firstSlash === path.length - 1 ? '**/' : ''
  const normalized = stripTrailingSlash(
    path.startsWith('/') ? path.slice(1) : path,
  )
  const pattern = `${prefix}${normalized}`
  return pattern.endsWith('/*') || pattern.endsWith('/**')
    ? [pattern]
    : [pattern, `${pattern}/**`]
}

function pathRelativeToTarget(path: string, target: string): string | undefined {
  const normalized = normalizeProjectIgnorePath(path)
  if (target === '.' || target === '') {
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
  const recursiveTargetPrefix = `${targetPrefix}**/`
  if (normalized.startsWith(recursiveTargetPrefix)) {
    return normalized.slice(targetPrefix.length)
  }
  return undefined
}

function normalizeProjectIgnorePath(path: string): string {
  return stripTrailingSlash(
    toPosixPath(path.startsWith('/') ? path.slice(1) : path),
  )
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
