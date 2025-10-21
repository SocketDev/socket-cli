import { debug, debugDir } from '@socketsecurity/lib/debug'
import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import { fetchPurlsShallowScore } from './fetch-purls-shallow-score.mts'
import { outputPurlsShallowScore } from './output-purls-shallow-score.mts'

export async function handlePurlsShallowScore({
  outputKind,
  purls,
}: {
  outputKind: OutputKind
  purls: string[]
}) {
  debug(`Fetching shallow scores for ${purls.length} packages`)
  debugDir({ purls, outputKind })

  const packageData = await fetchPurlsShallowScore(purls)

  debug(
    `Shallow scores ${packageData.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir({ packageData })

  outputPurlsShallowScore(
    purls,
    packageData as CResult<SocketArtifact[]>,
    outputKind,
  )
}
