import process from 'node:process'

import { fetchPackageInfo } from './fetch-package-info'
import { formatPackageInfo } from './format-package-info'
import { objectSome } from '../../utils/objects'

import type { SocketSdkAlert } from '../../utils/alert/severity'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export interface PackageData {
  data: SocketSdkReturnType<'getIssuesByNPMPackage'>['data']
  severityCount: Record<SocketSdkAlert['severity'], number>
  score: SocketSdkReturnType<'getScoreByNPMPackage'>['data']
}

export async function getPackageInfo({
  commandName,
  includeAllIssues,
  outputKind,
  pkgName,
  pkgVersion,
  strict
}: {
  commandName: string
  includeAllIssues: boolean
  outputKind: 'json' | 'markdown' | 'print'
  pkgName: string
  pkgVersion: string
  strict: boolean
}) {
  const packageData = await fetchPackageInfo(
    pkgName,
    pkgVersion,
    includeAllIssues
  )

  if (packageData) {
    formatPackageInfo(packageData, {
      name: commandName,
      includeAllIssues,
      outputKind,
      pkgName,
      pkgVersion
    })

    if (strict && objectSome(packageData.severityCount)) {
      // Let NodeJS exit gracefully but with exit(1)
      process.exitCode = 1
    }
  }
}
