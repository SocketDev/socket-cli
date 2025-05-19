import { fetchPurlsShallowScore } from './fetch-purls-shallow-score.mts'
import { outputPurlsShallowScore } from './output-purls-shallow-score.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { components } from '@socketsecurity/sdk/types/api'

export async function handlePurlsShallowScore({
  outputKind,
  purls,
}: {
  outputKind: OutputKind
  purls: string[]
}) {
  const packageData = await fetchPurlsShallowScore(purls)

  outputPurlsShallowScore(
    purls,
    packageData as CResult<Array<components['schemas']['SocketArtifact']>>,
    outputKind,
  )
}
