import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdTable } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'
import { getPurlObject } from '../../util/purl/parse.mts'

import type { ThreadFeedResponse } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'

const logger = getDefaultLogger()

export function formatThreatFeedTable(data: ThreadFeedResponse): string {
  const rows = data.results.map(r => {
    const purlObj = getPurlObject(r.purl, { throws: false })
    return {
      created: r.createdAt,
      ecosystem: purlObj?.type ?? '',
      name: purlObj?.name ?? '',
      version: purlObj?.version ?? '',
      threat: r.threatType,
      description: r.description,
    }
  })
  return mdTable(rows as unknown as Array<Record<string, string>>, [
    'created',
    'ecosystem',
    'name',
    'version',
    'threat',
    'description',
  ])
}

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

  logger.log(formatThreatFeedTable(result.data))
}
