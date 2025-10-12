import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

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
  debugFn(`Fetching shallow scores for ${purls.length} packages`)
  debugDir({ purls, outputKind })

  const packageData = await fetchPurlsShallowScore(purls)

  debugFn(
    `Shallow scores ${packageData.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir({ packageData })

  outputPurlsShallowScore(
    purls,
    packageData as CResult<SocketArtifact[]>,
    outputKind,
  )
}
