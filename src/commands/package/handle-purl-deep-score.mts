/** @fileoverview Package deep score business logic handler for Socket CLI. Orchestrates detailed package security analysis retrieval and delegates to output formatter with comprehensive score data. */

import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'
import { outputPurlsDeepScore } from './output-purls-deep-score.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

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
