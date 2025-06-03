import { fetchPurlsShallowScore } from './fetch-purls-shallow-score.mts'
import { outputPurlsShallowScore } from './output-purls-shallow-score.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'

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
    packageData as CResult<SocketArtifact[]>,
    outputKind,
  )
}
