import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdHeader, mdKeyValue } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
const logger = getDefaultLogger()

export async function outputScanMetadata(
  result: CResult<SocketSdkSuccessResult<'getFullScanMetadata'>['data']>,
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
    logger.log(`${mdHeader('Scan meta data')}`)
    logger.log('')
    logger.log(`${mdKeyValue('Scan ID', scanId)}`)
    logger.log('')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
      logger.log(`- ${key}: ${value}`)
    }
    logger.log(
      `\nYou can view this report at: [${result.data.html_report_url}](${result.data.html_report_url})\n`,
    )
  } else {
    logger.log(`Scan ID: ${scanId}`)
    logger.log('')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
    logger.log(
      `\nYou can view this report at: ${result.data.html_report_url}]\n`,
    )
  }
}
