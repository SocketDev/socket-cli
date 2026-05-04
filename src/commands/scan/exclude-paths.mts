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
  return stripped.endsWith('/*') ? stripped : `${stripped}/**`
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
