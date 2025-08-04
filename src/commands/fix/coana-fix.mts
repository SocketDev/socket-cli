import { debugDir } from '@socketsecurity/registry/lib/debug'

import { handleApiCall } from '../../utils/api.mts'
import { spawnCoana } from '../../utils/coana.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { FixConfig } from './agent-fix.mts'
import type { CResult } from '../../types.mts'

export async function coanaFix(
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { ghsas } = fixConfig

  if (!ghsas.length) {
    return { ok: true, data: { fixed: false } }
  }

  const { cwd, orgSlug, spinner } = fixConfig

  spinner?.start()

  const sockSdkCResult = await setupSdk()

  let lastCResult: CResult<any> = sockSdkCResult

  const sockSdk = sockSdkCResult.ok ? sockSdkCResult.data : undefined

  const supportedFilesCResult = sockSdk
    ? await fetchSupportedScanFileNames()
    : undefined

  if (supportedFilesCResult) {
    lastCResult = supportedFilesCResult
  }

  const supportedFiles = supportedFilesCResult?.ok
    ? supportedFilesCResult.data
    : undefined

  const packagePaths = supportedFiles
    ? await getPackageFilesForScan(['.'], supportedFiles!, {
        cwd,
      })
    : []

  const uploadCResult = sockSdk
    ? await handleApiCall(sockSdk?.uploadManifestFiles(orgSlug, packagePaths), {
        desc: 'upload manifests',
      })
    : undefined

  if (uploadCResult) {
    lastCResult = uploadCResult
  }

  const tarHash = uploadCResult?.ok ? (uploadCResult as any).data.tarHash : ''

  if (!tarHash) {
    spinner?.stop()
    return lastCResult as CResult<any>
  }

  const isAuto =
    ghsas.length === 1 && (ghsas[0] === 'all' || ghsas[0] === 'auto')

  const ids = isAuto ? ['all'] : ghsas

  const fixCResult = ids.length
    ? await spawnCoana(
        [
          'compute-fixes-and-upgrade-purls',
          cwd,
          '--manifests-tar-hash',
          tarHash,
          '--apply-fixes-to',
          ...ids,
          ...fixConfig.unknownFlags,
        ],
        { cwd, spinner, env: { SOCKET_ORG_SLUG: orgSlug } },
      )
    : undefined

  if (fixCResult) {
    lastCResult = fixCResult
  }

  spinner?.stop()

  debugDir('inspect', { lastCResult })

  return lastCResult.ok
    ? {
        ok: true,
        data: { fixed: true },
      }
    : (lastCResult as CResult<any>)
}
