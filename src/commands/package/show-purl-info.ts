import { components } from '@socketsecurity/sdk/types/api'

import { fetchPackageInfo } from './fetch-package-info'
import { logPackageInfo } from './log-package-info'

import type { SocketSdkAlert } from '../../utils/alert/severity'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export interface PackageData {
  data: SocketSdkReturnType<'getIssuesByNPMPackage'>['data']
  severityCount: Record<SocketSdkAlert['severity'], number>
  score: SocketSdkReturnType<'getScoreByNPMPackage'>['data']
}

export async function showPurlInfo({
  // commandName,
  outputKind,
  purls
  // strict
}: {
  // commandName: string
  outputKind: 'json' | 'markdown' | 'text'
  purls: string[]
  // strict: boolean
}) {
  const packageData = await fetchPackageInfo(purls)
  if (packageData) {
    logPackageInfo(
      purls,
      packageData.data as Array<components['schemas']['SocketArtifact']>,
      outputKind
    )
  }
}
