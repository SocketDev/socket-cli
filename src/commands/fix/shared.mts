import type { FixOptions, NormalizedFixOptions } from './types.mts'

export const CMD_NAME = 'socket fix'

export const alertMapOptions = Object.freeze({
  consolidate: true,
  include: {
    existing: true,
    unfixable: false,
    upgradable: false
  },
  nothrow: true
})

export function normalizeFixOptions(
  options_: FixOptions
): NormalizedFixOptions {
  const options = {
    __proto__: null,
    ...options_
  } as FixOptions
  if (typeof options.autopilot !== 'boolean') {
    options.autopilot = false
  }
  if (typeof options.autoMerge !== 'boolean') {
    options.autoMerge = !!options.autopilot
  }
  if (typeof options.cwd !== 'string') {
    options.cwd = process.cwd()
  }
  options.purls = Array.isArray(options.purls)
    ? options.purls.flatMap(p => p.split(/, */))
    : []

  if (typeof options.rangeStyle !== 'string') {
    options.rangeStyle = 'preserve'
  }
  if (typeof options.test !== 'boolean') {
    options.test = !!options.autopilot || !!options.testScript
  }
  if (typeof options.testScript !== 'string') {
    options.testScript = 'test'
  }
  return options as NormalizedFixOptions
}
