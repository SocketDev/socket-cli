import { arrayUnique } from '@socketsecurity/registry/lib/arrays'

import { extractPurlsFromPnpmLockfile } from './pnpm.mts'
import { getPublicToken, setupSdk } from './sdk.mts'
import { addArtifactToAlertsMap } from './socket-package-alert.mts'

import type { CompactSocketArtifact } from './alert/artifact.mts'
import type {
  AlertIncludeFilter,
  AlertsByPkgId
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
  options_?: GetAlertsMapFromPnpmLockfileOptions | undefined
): Promise<AlertsByPkgId> {
  const options = {
    __proto__: null,
    consolidate: false,
    limit: Infinity,
    nothrow: false,
    ...options_
  } as GetAlertsMapFromPnpmLockfileOptions
  const purls = extractPurlsFromPnpmLockfile(lockfile)
  return await getAlertsMapFromPurls(purls, {
    overrides: lockfile.overrides,
    ...options
  })
}

export type GetAlertsMapFromPurlsOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
  limit?: number | undefined
  overrides?: { [key: string]: string } | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromPurls(
  purls: string[] | readonly string[],
  options_?: GetAlertsMapFromPurlsOptions | undefined
): Promise<AlertsByPkgId> {
  const options = {
    __proto__: null,
    consolidate: false,
    limit: Infinity,
    nothrow: false,
    ...options_
  } as GetAlertsMapFromPurlsOptions

  const include = {
    __proto__: null,
    actions: undefined,
    blocked: true,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgradable: false,
    ...options.include
  } as AlertIncludeFilter

  const { spinner } = options

  const uniqPurls = arrayUnique(purls)
  let { length: remaining } = uniqPurls
  const alertsByPkgId: AlertsByPkgId = new Map()
  if (!remaining) {
    return alertsByPkgId
  }
  const getText = () => `Looking up data for ${remaining} packages`

  spinner?.start(getText())

  const sockSdk = await setupSdk(getPublicToken())

  const toAlertsMapOptions = {
    overrides: options.overrides,
    consolidate: options.consolidate,
    include,
    spinner
  }

  for await (const batchResult of sockSdk.batchPackageStream(
    {
      alerts: 'true',
      compact: 'true',
      ...(include.actions ? { actions: include.actions.join(',') } : {}),
      ...(include.unfixable ? {} : { fixable: 'true' })
    },
    {
      components: uniqPurls.map(purl => ({ purl }))
    }
  )) {
    if (batchResult.success) {
      await addArtifactToAlertsMap(
        batchResult.data as CompactSocketArtifact,
        alertsByPkgId,
        toAlertsMapOptions
      )
    } else if (!options.nothrow) {
      const statusCode = batchResult.status ?? 'unknown'
      const statusMessage = batchResult.error ?? 'No status message'
      throw new Error(
        `Socket API server error (${statusCode}): ${statusMessage}`
      )
    }
    remaining -= 1
    if (spinner && remaining > 0) {
      spinner.start()
      spinner.setText(getText())
    }
  }

  spinner?.stop()

  return alertsByPkgId
}
