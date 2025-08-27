import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { toFilterConfig } from './filter-config.mts'
import { extractPurlsFromPnpmLockfile } from './pnpm.mts'
import { getPublicApiToken, setupSdk } from './sdk.mts'
import { addArtifactToAlertsMap } from './socket-package-alert.mts'

import type { CompactSocketArtifact } from './alert/artifact.mts'
import type { AlertFilter, AlertsByPurl } from './socket-package-alert.mts'
import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type GetAlertsMapFromPnpmLockfileOptions = {
  consolidate?: boolean | undefined
  include?: AlertFilter | undefined
  overrides?: { [key: string]: string } | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromPnpmLockfile(
  lockfile: LockfileObject,
  options?: GetAlertsMapFromPnpmLockfileOptions | undefined,
): Promise<AlertsByPurl> {
  const purls = await extractPurlsFromPnpmLockfile(lockfile)
  return await getAlertsMapFromPurls(purls, {
    overrides: lockfile.overrides,
    ...options,
  })
}

export type GetAlertsMapFromPurlsOptions = {
  consolidate?: boolean | undefined
  filter?: AlertFilter | undefined
  overrides?: { [key: string]: string } | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromPurls(
  purls: string[] | readonly string[],
  options?: GetAlertsMapFromPurlsOptions | undefined,
): Promise<AlertsByPurl> {
  const opts = {
    __proto__: null,
    consolidate: false,
    nothrow: false,
    ...options,
    filter: toFilterConfig(getOwn(options, 'filter')),
  } as GetAlertsMapFromPurlsOptions & { filter: AlertFilter }

  const uniqPurls = arrayUnique(purls)
  debugDir('silly', { purls: uniqPurls })

  let { length: remaining } = uniqPurls
  const alertsByPurl: AlertsByPurl = new Map()

  if (!remaining) {
    return alertsByPurl
  }

  const { spinner } = opts
  const getText = () => `Looking up data for ${remaining} packages`

  spinner?.start(getText())

  const sockSdkCResult = await setupSdk({ apiToken: getPublicApiToken() })
  if (!sockSdkCResult.ok) {
    spinner?.stop()
    throw new Error('Auth error: Try to run `socket login` first')
  }
  const sockSdk = sockSdkCResult.data

  const alertsMapOptions = {
    overrides: opts.overrides,
    consolidate: opts.consolidate,
    filter: opts.filter,
    spinner,
  }

  for await (const batchResult of sockSdk.batchPackageStream(
    {
      components: uniqPurls.map(purl => ({ purl })),
    },
    {
      queryParams: {
        alerts: 'true',
        compact: 'true',
        ...(Array.isArray(opts.filter.actions)
          ? { actions: opts.filter.actions.join(',') }
          : {}),
      },
    },
  )) {
    if (batchResult.success) {
      await addArtifactToAlertsMap(
        batchResult.data as CompactSocketArtifact,
        alertsByPurl,
        alertsMapOptions,
      )
    } else if (!opts.nothrow) {
      spinner?.stop()
      if (isNonEmptyString(batchResult.error)) {
        throw new Error(batchResult.error)
      }
      const statusCode = batchResult.status ?? 'unknown'
      throw new Error(
        `Socket API server error (${statusCode}): No status message`,
      )
    } else {
      spinner?.stop()
      logger.fail(
        `Received a ${batchResult.status} response from Socket API which we consider a permanent failure:`,
        batchResult.error,
        batchResult.cause ? `( ${batchResult.cause} )` : '',
      )
      debugDir('inspect', { batchResult })
      break
    }
    remaining -= 1
    if (remaining > 0) {
      spinner?.start(getText())
    }
  }

  spinner?.stop()

  return alertsByPurl
}
