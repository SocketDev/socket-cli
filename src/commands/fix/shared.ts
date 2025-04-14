import type { FixOptions, NormalizedFixOptions } from './types'

export const CMD_NAME = 'socket fix'

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
