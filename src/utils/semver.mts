import semver from 'semver'

import type { SemVer } from 'semver'

export const RangeStyles = ['caret', 'gt', 'lt', 'pin', 'preserve', 'tilde']

export type RangeStyle =
  | 'caret'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'pin'
  | 'preserve'
  | 'tilde'

export type { SemVer }

export function applyRange(
  refRange: string,
  version: string,
  style: RangeStyle = 'preserve',
): string {
  switch (style) {
    case 'caret':
      return `^${version}`
    case 'gt':
      return `>${version}`
    case 'gte':
      return `>=${version}`
    case 'lt':
      return `<${version}`
    case 'lte':
      return `<=${version}`
    case 'preserve': {
      const range = new semver.Range(refRange)
      const { raw } = range
      const comparators = [...range.set].flat()
      const { length } = comparators
      if (length === 1) {
        const char = /^[<>]=?/.exec(raw)?.[0]
        if (char) {
          return `${char}${version}`
        }
      } else if (length === 2) {
        const char = /^[~^]/.exec(raw)?.[0]
        if (char) {
          return `${char}${version}`
        }
      }
      return version
    }
    case 'tilde':
      return `~${version}`
    case 'pin':
    default:
      return version
  }
}

export function getMajor(version: unknown): number | null {
  try {
    const coerced = semver.coerce(version as string)
    return coerced ? semver.major(coerced) : null
  } catch {}
  return null
}

export function getMinVersion(range: unknown): SemVer | null {
  try {
    return semver.minVersion(range as string)
  } catch {}
  return null
}
