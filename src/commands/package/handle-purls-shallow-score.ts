import { fetchPurlsShallowScore } from './fetch-purls-shallow-score'
import { outputPurlsShallowScore } from './output-purls-shallow-score'

import type { OutputKind } from '../../types'
import type { components } from '@socketsecurity/sdk/types/api'

export async function handlePurlsShallowScore({
  outputKind,
  purls
}: {
  outputKind: OutputKind
  purls: string[]
}) {
  const packageData = await fetchPurlsShallowScore(purls)
  if (!packageData) {
    return
  }

  outputPurlsShallowScore(
    purls,
    packageData.data as Array<components['schemas']['SocketArtifact']>,
    outputKind
  )
}
