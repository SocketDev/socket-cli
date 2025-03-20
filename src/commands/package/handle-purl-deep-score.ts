import { fetchPurlDeepScore } from './fetch-purl-deep-score'
import { outputPurlScore } from './output-purl-score'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: 'json' | 'markdown' | 'text'
) {
  const data = await fetchPurlDeepScore(purl)
  if (!data) return

  await outputPurlScore(purl, data, outputKind)
}
