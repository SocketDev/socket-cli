import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
const logger = getDefaultLogger()

type QuotaData = SocketSdkSuccessResult<'getQuota'>['data']

function formatRefresh(nextWindowRefresh: string | null | undefined): string {
  if (!nextWindowRefresh) {
    return 'unknown'
  }
  const ts = Date.parse(nextWindowRefresh)
  if (Number.isNaN(ts)) {
    return nextWindowRefresh
  }
  const now = Date.now()
  const diffMs = ts - now
  const date = new Date(ts).toISOString()
  if (diffMs <= 0) {
    return `${date} (due now)`
  }
  const mins = Math.round(diffMs / 60_000)
  if (mins < 60) {
    return `${date} (in ${mins} min)`
  }
  const hours = Math.round(mins / 60)
  if (hours < 48) {
    return `${date} (in ${hours} h)`
  }
  const days = Math.round(hours / 24)
  return `${date} (in ${days} d)`
}

function formatUsageLine(data: QuotaData): string {
  const remaining = data.quota
  const max = data.maxQuota
  if (!max) {
    return `Quota remaining: ${remaining}`
  }
  const used = Math.max(0, max - remaining)
  const pct = Math.round((used / max) * 100)
  return `Quota remaining: ${remaining} / ${max} (${pct}% used)`
}

export async function outputQuota(
  result: CResult<QuotaData>,
  outputKind: OutputKind = 'text',
): Promise<void> {
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

  const usageLine = formatUsageLine(result.data)
  const refreshLine = `Next refresh: ${formatRefresh(result.data.nextWindowRefresh)}`

  if (outputKind === 'markdown') {
    logger.log(mdHeader('Quota'))
    logger.log('')
    logger.log(`- ${usageLine}`)
    logger.log(`- ${refreshLine}`)
    logger.log('')
    return
  }

  logger.log(usageLine)
  logger.log(refreshLine)
  logger.log('')
}
