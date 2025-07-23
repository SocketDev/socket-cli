import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { extractPurlsFromPnpmLockfile } from './pnpm.mts'
import { getPublicToken, setupSdk } from './sdk.mts'
import { addArtifactToAlertsMap } from './socket-package-alert.mts'

import type { CompactSocketArtifact } from './alert/artifact.mts'
import type {
  AlertIncludeFilter,
  AlertsByPurl,
} from './socket-package-alert.mts'
import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type GetAlertsMapFromPnpmLockfileOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
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
  include?: AlertIncludeFilter | undefined
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
    include: undefined,
    nothrow: false,
    ...options,
  } as GetAlertsMapFromPurlsOptions

  opts.include = {
    __proto__: null,
    // Leave 'actions' unassigned so it can be given a default value in
    // subsequent functions where `options` is passed.
    // actions: undefined,
    blocked: true,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgradable: false,
    ...opts.include,
  } as AlertIncludeFilter

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

  const sockSdkCResult = await setupSdk({ apiToken: getPublicToken() })
  if (!sockSdkCResult.ok) {
    spinner?.stop()
    throw new Error('Auth error: Try to run `socket login` first')
  }
  const sockSdk = sockSdkCResult.data

  const alertsMapOptions = {
    overrides: opts.overrides,
    consolidate: opts.consolidate,
    include: opts.include,
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
        ...(opts.include.actions
          ? { actions: opts.include.actions.join(',') }
          : {}),
        ...(opts.include.unfixable ? {} : { fixable: 'true' }),
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
      const statusCode = batchResult.status ?? 'unknown'
      const statusMessage = batchResult.error ?? 'No status message'
      throw new Error(
        `Socket API server error (${statusCode}): ${statusMessage}`,
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
