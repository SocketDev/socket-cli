import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'
import { outputPurlsDeepScore } from './output-purls-deep-score.mts'

import type { OutputKind } from '../../types.mts'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: OutputKind,
) {
  debugFn(`Fetching deep score for ${purl}`)
  debugDir({ purl, outputKind })

  const result = await fetchPurlDeepScore(purl)

  debugFn(`Deep score ${result.ok ? 'fetched successfully' : 'fetch failed'}`)
  debugDir({ result })

  await outputPurlsDeepScore(purl, result, outputKind)
}
