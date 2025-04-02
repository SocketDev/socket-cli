import { detectDepTypes } from '@pnpm/lockfile.detect-dep-types'

import { getPublicToken, setupSdk } from '../sdk'
import { addArtifactToAlertsMap } from '../socket-package-alert'

import type { CompactSocketArtifact } from '../alert/artifact'
import type { AlertIncludeFilter, AlertsByPkgId } from '../socket-package-alert'
import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type GetAlertsMapFromPnpmLockfileOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
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
    nothrow: false,
    ...options_
  } as GetAlertsMapFromPnpmLockfileOptions

  const include = {
    __proto__: null,
    blocked: true,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgradable: false,
    ...options.include
  } as AlertIncludeFilter

  const { spinner } = options

  const depTypes = detectDepTypes(lockfile)
  const pkgIds = Object.keys(depTypes)

  let { length: remaining } = pkgIds
  const alertsByPkgId: AlertsByPkgId = new Map()
  if (!remaining) {
    return alertsByPkgId
  }
  const getText = () => `Looking up data for ${remaining} packages`

  spinner?.start(getText())

  const sockSdk = await setupSdk(getPublicToken())

  const toAlertsMapOptions = {
    overrides: lockfile.overrides,
    consolidate: options.consolidate,
    include,
    spinner
  }

  for await (const batchResult of sockSdk.batchPackageStream(
    {
      alerts: 'true',
      compact: 'true',
      fixable: include.unfixable ? 'false' : 'true'
    },
    {
      components: pkgIds.map(id => ({ purl: `pkg:npm/${id}` }))
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
      throw new Error(`Socket API server error (${statusCode}): ${statusMessage}`)
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
