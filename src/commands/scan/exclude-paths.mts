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
): string[] {
  if (!Array.isArray(paths) || paths.some(path => path.includes('!'))) {
    return []
  }
  return paths.flatMap(path => {
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
  })
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
