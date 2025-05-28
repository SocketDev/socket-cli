import type { GetAlertsMapFromPurlsOptions } from '../../utils/alerts-map.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export const CMD_NAME = 'socket fix'

export function getAlertsMapOptions(
  options: GetAlertsMapFromPurlsOptions = {},
) {
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
      ...options?.include,
    },
  } as Remap<
    Omit<GetAlertsMapFromPurlsOptions, 'include' | 'overrides' | 'spinner'> & {
      include: Exclude<GetAlertsMapFromPurlsOptions['include'], undefined>
    }
  >
}
