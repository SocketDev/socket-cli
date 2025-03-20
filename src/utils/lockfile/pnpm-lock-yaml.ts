import { detectDepTypes } from '@pnpm/lockfile.detect-dep-types'

import { getPublicToken, setupSdk } from '../sdk'
import { addArtifactToAlertsMap } from '../socket-package-alert'

import type { CompactSocketArtifact } from '../alert/artifact'
import type { AlertsByPkgId } from '../socket-package-alert'
import type { Lockfile } from '@pnpm/lockfile-file'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

type AlertIncludeFilter = {
  critical?: boolean | undefined
  cve?: boolean | undefined
  existing?: boolean | undefined
  unfixable?: boolean | undefined
  upgrade?: boolean | undefined
}

type GetAlertsMapFromPnpmLockfileOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromPnpmLockfile(
  lockfile: Lockfile,
  options?: GetAlertsMapFromPnpmLockfileOptions | undefined
): Promise<AlertsByPkgId> {
  const { include: _include, spinner } = {
    __proto__: null,
    ...options
  } as GetAlertsMapFromPnpmLockfileOptions

  const depTypes = detectDepTypes(lockfile)
  const pkgIds = Object.keys(depTypes)

  let { length: remaining } = pkgIds
  const alertsByPkgId: AlertsByPkgId = new Map()
  if (!remaining) {
    return alertsByPkgId
  }
  const getText = () => `Looking up data for ${remaining} packages`

  spinner?.start(getText())

  const socketSdk = await setupSdk(getPublicToken())

  const toAlertsMapOptions = {
    overrides: lockfile.overrides,
    ...options
  }

  for await (const batchPackageFetchResult of socketSdk.batchPackageStream(
    {
      alerts: 'true',
      compact: 'true'
    },
    {
      components: pkgIds.map(id => ({ purl: `pkg:npm/${id}` }))
    }
  )) {
    if (batchPackageFetchResult.success) {
      await addArtifactToAlertsMap(
        batchPackageFetchResult.data as CompactSocketArtifact,
        alertsByPkgId,
        toAlertsMapOptions
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
