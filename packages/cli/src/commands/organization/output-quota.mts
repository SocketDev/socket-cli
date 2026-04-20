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
  // Under a minute, say "<1 min" rather than the misleading "in 0 min".
  if (diffMs < 60_000) {
    return `${date} (in <1 min)`
  }
  // Thresholds promote one unit early (59.5 min → "in 1 h") to avoid
  // degenerate displays like "in 60 min" from naive rounding.
  if (diffMs < 3_570_000) {
    return `${date} (in ${Math.round(diffMs / 60_000)} min)`
  }
  if (diffMs < 171_000_000) {
    return `${date} (in ${Math.round(diffMs / 3_600_000)} h)`
  }
  return `${date} (in ${Math.round(diffMs / 86_400_000)} d)`
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
