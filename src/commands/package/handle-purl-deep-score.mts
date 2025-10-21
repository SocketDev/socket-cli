import { debug, debugDir } from '@socketsecurity/lib/debug'
import type { OutputKind } from '../../types.mts'
import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'
import { outputPurlsDeepScore } from './output-purls-deep-score.mts'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: OutputKind,
) {
  debug(`Fetching deep score for ${purl}`)
  debugDir({ purl, outputKind })

  const result = await fetchPurlDeepScore(purl)

  debug(`Deep score ${result.ok ? 'fetched successfully' : 'fetch failed'}`)
  debugDir({ result })

  await outputPurlsDeepScore(purl, result, outputKind)
}
