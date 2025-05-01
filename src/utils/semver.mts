import semver from 'semver'

import { debugLog } from '@socketsecurity/registry/lib/debug'

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

export function applyRange(
  refRange: string,
  version: string,
  style: RangeStyle = 'preserve'
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

export function getMajor(version: string): number | null {
  const coerced = semver.coerce(version)
  if (coerced) {
    try {
      return semver.major(coerced)
    } catch (e) {
      debugLog(`Error parsing '${version}':\n`, e)
    }
  }
  return null
}
