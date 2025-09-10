import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputScanMetadata(
  result: CResult<SocketSdkSuccessResult<'getOrgFullScanMetadata'>['data']>,
  scanId: string,
  outputKind: OutputKind,
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

  if (outputKind === 'markdown') {
    logger.log('# Scan meta data\n')
  }
  logger.log(`Scan ID: ${scanId}\n`)
  for (const { 0: key, 1: value } of Object.entries(result.data)) {
    if (
      [
        'id',
        'updated_at',
        'organization_id',
        'repository_id',
        'commit_hash',
        'html_report_url',
      ].includes(key)
    ) {
      continue
    }
    logger.log(`- ${key}:`, value)
  }
  if (outputKind === 'markdown') {
    logger.log(
      `\nYou can view this report at: [${result.data.html_report_url}](${result.data.html_report_url})\n`,
    )
  } else {
    logger.log(
      `\nYou can view this report at: ${result.data.html_report_url}]\n`,
    )
  }
}
