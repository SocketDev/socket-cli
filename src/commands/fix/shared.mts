import type { FixOptions, NormalizedFixOptions } from './types.mts'
import type { GetAlertsMapFromPurlsOptions } from '../../utils/alerts-map.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export const CMD_NAME = 'socket fix'

export function getAlertMapOptions(options: GetAlertsMapFromPurlsOptions = {}) {
  return {
    __proto__: null,
    consolidate: true,
    nothrow: true,
    ...options,
    include: {
      __proto__: null,
      existing: true,
      unfixable: false,
      upgradable: false,
      ...options?.include
    }
  } as Remap<
    Omit<GetAlertsMapFromPurlsOptions, 'include' | 'overrides' | 'spinner'> & {
      include: Exclude<GetAlertsMapFromPurlsOptions['include'], undefined>
    }
  >
}

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
  const limit =
    typeof options.limit === 'number'
      ? options.limit
      : parseInt(`${options.limit || ''}`, 10)

  options.limit = Number.isNaN(limit) ? Infinity : limit

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
