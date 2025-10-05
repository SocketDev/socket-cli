/** @fileoverview Scan metadata output formatter for Socket CLI. Displays scan configuration metadata in JSON or text formats. Shows supported file types, ecosystems, and scan parameters. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputScanMetadata(
  result: CResult<SocketSdkSuccessResult<'getOrgFullScanMetadata'>['data']>,
  scanId: string,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: data => {
      if (outputKind === 'markdown') {
        logger.log('# Scan meta data\n')
      }
      logger.log(`Scan ID: ${scanId}\n`)
      for (const { 0: key, 1: value } of Object.entries(data)) {
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
          `\nYou can view this report at: [${data.html_report_url}](${data.html_report_url})\n`,
        )
      } else {
        logger.log(`\nYou can view this report at: ${data.html_report_url}]\n`)
      }
      return ''
    },
  })
}
