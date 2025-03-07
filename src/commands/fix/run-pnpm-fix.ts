import { readWantedLockfile } from '@pnpm/lockfile-file'

import { getAlertsMapFromPnpmLockfile } from '../../utils/lockfile/pnpm-lock-yaml'

import type { Spinner } from '@socketsecurity/registry/lib/spinner'

type PnpmFixOptions = {
  spinner?: Spinner | undefined
}

export async function pnpmFix(
  cwd: string,
  options?: PnpmFixOptions | undefined
) {
  const { spinner } = { __proto__: null, ...options } as PnpmFixOptions

  spinner?.start()

  const lockfile = await readWantedLockfile(cwd, { ignoreIncompatible: false })

  const alertsMap = await getAlertsMapFromPnpmLockfile(
    lockfile!,
    {},
    {
      consolidate: true,
      include: {
        existing: true,
        unfixable: false,
        upgrade: false
      }
    }
  )

  console.log(alertsMap)

  spinner?.stop()
}
