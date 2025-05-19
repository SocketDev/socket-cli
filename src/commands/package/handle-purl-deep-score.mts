import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'
import { outputPurlScore } from './output-purl-score.mts'

import type { OutputKind } from '../../types.mts'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: OutputKind,
) {
  const result = await fetchPurlDeepScore(purl)

  await outputPurlScore(purl, result, outputKind)
}
