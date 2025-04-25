import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputScanMetadata(
  data: SocketSdkReturnType<'getOrgFullScanMetadata'>['data'],
  scanId: string,
  outputKind: OutputKind
): Promise<void> {
  if (outputKind === 'json') {
    logger.log(data)
  } else {
    // Markdown = print
    if (outputKind === 'markdown') {
      logger.log('# Scan meta data\n')
    }
    logger.log(`Scan ID: ${scanId}\n`)
    for (const [key, value] of Object.entries(data)) {
      if (
        [
          'id',
          'updated_at',
          'organization_id',
          'repository_id',
          'commit_hash',
          'html_report_url'
        ].includes(key)
      ) {
        continue
      }
      logger.log(`- ${key}:`, value)
    }
    if (outputKind === 'markdown') {
      logger.log(
        `\nYou can view this report at: [${data.html_report_url}](${data.html_report_url})\n`
      )
    } else {
      logger.log(`\nYou can view this report at: ${data.html_report_url}]\n`)
    }
  }
}
