import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { fetchPackageInfo } from './fetch-package-info.ts'
import { formatPackageInfo } from './format-package-info.ts'

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
  outputJson,
  outputMarkdown,
  pkgName,
  pkgVersion,
  strict
}: {
  commandName: string
  includeAllIssues: boolean
  outputJson: boolean
  outputMarkdown: boolean
  pkgName: string
  pkgVersion: string
  strict: boolean
}) {
  const spinnerText =
    pkgVersion === 'latest'
      ? `Looking up data for the latest version of ${pkgName}`
      : `Looking up data for version ${pkgVersion} of ${pkgName}`
  const spinner = new Spinner({ text: spinnerText }).start()
  const packageData = await fetchPackageInfo(
    pkgName,
    pkgVersion,
    includeAllIssues,
    spinner
  )
  if (packageData) {
    formatPackageInfo(
      packageData,
      {
        name: commandName,
        includeAllIssues,
        outputJson,
        outputMarkdown,
        pkgName,
        pkgVersion,
        strict
      },
      spinner
    )
  }
}
