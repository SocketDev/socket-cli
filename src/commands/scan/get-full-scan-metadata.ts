import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function getOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  outputKind: 'json' | 'markdown' | 'print'
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await getOrgScanMetadataWithToken(orgSlug, scanId, apiToken, outputKind)
}
export async function getOrgScanMetadataWithToken(
  orgSlug: string,
  scanId: string,
  apiToken: string,
  outputKind: 'json' | 'markdown' | 'print'
): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching meta data for a full scan...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgFullScanMetadata(orgSlug, scanId),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanMetadata', result, spinner)
    return
  }

  spinner?.successAndStop('Fetched the meta data\n')

  if (outputKind === 'json') {
    logger.log(result.data)
  } else {
    // Markdown = print
    if (outputKind === 'markdown') {
      logger.log('# Scan meta data\n')
    }
    logger.log(`Scan ID: ${scanId}\n`)
    for (const [key, value] of Object.entries(result.data)) {
      if (
        [
          'id',
          'updated_at',
          'organization_id',
          'repository_id',
          'commit_hash',
          'html_report_url'
        ].includes(key)
      )
        continue
      logger.log(`- ${key}:`, value)
    }
    if (outputKind === 'markdown') {
      logger.log(
        `\nYou can view this report at: [${result.data.html_report_url}](${result.data.html_report_url})\n`
      )
    } else {
      logger.log(
        `\nYou can view this report at: ${result.data.html_report_url}]\n`
      )
    }
  }
}
