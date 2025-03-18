import { fetchPackageInfo } from './fetch-package-info'
import { logPackageInfo } from './log-package-info'

import type { components } from '@socketsecurity/sdk/types/api'

export async function showPurlInfo({
  outputKind,
  purls
}: {
  outputKind: 'json' | 'markdown' | 'text'
  purls: string[]
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
