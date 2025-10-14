import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { ThreadFeedResponse } from './types.mts'

export async function outputThreatFeed(
  result: CResult<ThreadFeedResponse>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (!result.data?.results?.length) {
    logger.warn('Did not receive any data to display.')
    return
  }

  await outputWithInk(result.data)
}

/**
 * Display threat feed using Ink React components.
 */
async function outputWithInk(data: ThreadFeedResponse): Promise<void> {
  const React = await import('react')
  // @ts-ignore - tsx files treated as CJS by tsgo without package.json type:module
  const { render } = await import('ink')
  // @ts-ignore - tsx files treated as CJS by tsgo without package.json type:module
  const { ThreatFeedApp } = await import('./ThreatFeedApp.js')

  render(React.createElement(ThreatFeedApp, { results: data.results }))
}
