import { fetchPurlsShallowScore } from './fetch-purls-shallow-score.mts'
import { outputPurlsShallowScore } from './output-purls-shallow-score.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'

export async function handlePurlsShallowScore({
  outputKind,
  purls,
}: {
  outputKind: OutputKind
  purls: string[]
}) {
  debugFn('notice', `Fetching shallow scores for ${purls.length} packages`)
  debugDir('inspect', { purls, outputKind })

  const packageData = await fetchPurlsShallowScore(purls)

  debugFn(
    'notice',
    `Shallow scores ${packageData.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir('inspect', { packageData })

  outputPurlsShallowScore(
    purls,
    packageData as CResult<SocketArtifact[]>,
    outputKind,
  )
}
