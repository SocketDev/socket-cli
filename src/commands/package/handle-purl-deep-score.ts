import { fetchPurlDeepScore } from './fetch-purl-deep-score'
import { outputPurlScore } from './output-purl-score'

import type { OutputKind } from '../../types'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: OutputKind
) {
  const data = await fetchPurlDeepScore(purl)
  if (!data) {
    return
  }

  await outputPurlScore(purl, data, outputKind)
}
