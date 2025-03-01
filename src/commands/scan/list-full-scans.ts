// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function listFullScans(
  orgSlug: string,
  input: {
    // TODO: what do we actually need for getOrgFullScanList ?
    outputJson: boolean
    outputMarkdown: boolean
    orgSlug: string
    sort: string
    direction: string
    per_page: number
    page: number
    from_time: string
    until_time: string
  },
  apiToken: string
): Promise<void> {
  const spinner = new Spinner()

  spinner.start('Listing scans...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgFullScanList(orgSlug, input),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
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

  spinner.stop(`Listing scans for: ${orgSlug}`)
  console.log(chalkTable(options, formattedResults))
}
