import { hasKeys } from '@socketsecurity/registry/lib/objects'

import { fetchPackageInfo } from './fetch-package-info.mts'
import { outputPackageInfo } from './output-package-info.mts'

import type { OutputKind } from '../../types.mts'
import type { SocketSdkAlert } from '../../utils/alert/severity.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export interface PackageData {
  data: SocketSdkReturnType<'getIssuesByNPMPackage'>['data']
  severityCount: Record<SocketSdkAlert['severity'], number>
  score: SocketSdkReturnType<'getScoreByNPMPackage'>['data']
}

export async function handlePackageInfo({
  commandName,
  includeAllIssues,
  outputKind,
  pkgName,
  pkgVersion,
  strict,
}: {
  commandName: string
  includeAllIssues: boolean
  outputKind: OutputKind
  pkgName: string
  pkgVersion: string
  strict: boolean
}) {
  const packageData = await fetchPackageInfo(
    pkgName,
    pkgVersion,
    includeAllIssues,
  )

  if (packageData) {
    outputPackageInfo(packageData, {
      commandName,
      includeAllIssues,
      outputKind,
      pkgName,
      pkgVersion,
    })

    if (strict && hasKeys(packageData.severityCount)) {
      // Let NodeJS exit gracefully but with exit(1)
      process.exitCode = 1
    }
  }
}
