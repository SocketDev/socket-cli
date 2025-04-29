import { fetchPurlDeepScore } from './fetch-purl-deep-score'
import { outputPurlScore } from './output-purl-score'

import type { OutputKind } from '../../types'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: OutputKind
) {
  const result = await fetchPurlDeepScore(purl)

  await outputPurlScore(purl, result, outputKind)
}
