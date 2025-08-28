import { getOwn } from '@socketsecurity/registry/lib/objects'

import { toFilterConfig } from '../../utils/filter-config.mts'

import type { GetAlertsMapFromPurlsOptions } from '../../utils/alerts-map.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export const CMD_NAME = 'socket fix'

export function getFixAlertsMapOptions(
  options: GetAlertsMapFromPurlsOptions = {},
) {
  return {
    __proto__: null,
    consolidate: true,
    nothrow: true,
    onlyFixable: true,
    ...options,
    filter: toFilterConfig({
      existing: true,
      ...getOwn(options, 'filter'),
    }),
  } as Remap<
    Omit<GetAlertsMapFromPurlsOptions, 'include' | 'overrides' | 'spinner'> & {
      filter: Exclude<GetAlertsMapFromPurlsOptions['filter'], undefined>
    }
  >
}
