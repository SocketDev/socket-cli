import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'
import { outputPurlsDeepScore } from './output-purls-deep-score.mts'

import type { OutputKind } from '../../types.mts'

export async function handlePurlDeepScore(
  purl: string,
  outputKind: OutputKind,
) {
  debugFn('notice', `Fetching deep score for ${purl}`)
  debugDir('inspect', { purl, outputKind })

  const result = await fetchPurlDeepScore(purl)

  debugFn(
    'notice',
    `Deep score ${result.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir('inspect', { result })

  await outputPurlsDeepScore(purl, result, outputKind)
}
