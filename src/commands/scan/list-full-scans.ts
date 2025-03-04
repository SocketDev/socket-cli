// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function listFullScans({
  direction,
  from_time,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort
}: {
  direction: string
  from_time: string
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'print'
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await listFullScansWithToken({
    apiToken,
    direction,
    from_time,
    orgSlug,
    outputKind,
    page,
    per_page,
    sort
  })
}

async function listFullScansWithToken({
  apiToken,
  direction,
  from_time,
  orgSlug,
  outputKind,
  page,
  per_page,
  sort
}: {
  apiToken: string
  direction: string
  from_time: string // seconds
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'print'
  page: number
  per_page: number
  sort: string
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching list of scans...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgFullScanList(orgSlug, {
      sort,
      direction,
      per_page,
      page,
      from: from_time
    }),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
    return
  }

  spinner.stop(`Fetch complete`)

  if (outputKind === 'json') {
    logger.log(result.data)
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'report_url', name: colors.magenta('Scan URL') },
      { field: 'branch', name: colors.magenta('Branch') },
      { field: 'created_at', name: colors.magenta('Created at') }
    ]
  }

  const formattedResults = result.data.results.map(d => {
    return {
      id: d.id,
      report_url: colors.underline(`${d.html_report_url}`),
      created_at: d.created_at
        ? new Date(d.created_at).toLocaleDateString('en-us', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
          })
        : '',
      branch: d.branch
    }
  })

  logger.log(chalkTable(options, formattedResults))
}
