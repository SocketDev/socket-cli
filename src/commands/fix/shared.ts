import semver from 'semver'

import type { FixOptions, NormalizedFixOptions, RangeStyle } from './types'

export function assignDefaultFixOptions(
  options: FixOptions
): NormalizedFixOptions {
  if (options.autoPilot === undefined) {
    options.autoPilot = false
  }
  if (options.autoMerge === undefined) {
    options.autoMerge = !!options.autoPilot
  }
  if (options.cwd === undefined) {
    options.cwd = process.cwd()
  }
  if (options.rangeStyle === undefined) {
    options.rangeStyle = 'preserve'
  }
  if (options.test === undefined) {
    options.test = !!options.autoPilot || !!options.testScript
  }
  if (options.testScript === undefined) {
    options.testScript = 'test'
  }
  return options as NormalizedFixOptions
}

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
      const comparators = [...new semver.Range(refRange).set].flat()
      const { length } = comparators
      return !length || length > 1
        ? version
        : `${comparators[0]!.operator}${version}`
    }
    case 'tilde':
      return `~${version}`
    case 'pin':
    default:
      return version
  }
}

export const RangeStyles = ['caret', 'gt', 'lt', 'pin', 'preserve', 'tilde']
