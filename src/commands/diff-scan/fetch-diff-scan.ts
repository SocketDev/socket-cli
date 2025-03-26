import colors from 'yoctocolors-cjs'

import constants from '../../constants'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchDiffScan({
  after,
  before,
  orgSlug
}: {
  after: string
  before: string
  orgSlug: string
}): Promise<SocketSdkReturnType<'GetOrgDiffScan'>['data'] | undefined> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  return await fetchDiffScanWithToken(apiToken, {
    after,
    before,
    orgSlug
  })
}

export async function fetchDiffScanWithToken(
  apiToken: string,
  {
    after,
    before,
    orgSlug
  }: {
    after: string
    before: string
    orgSlug: string
  }
): Promise<SocketSdkReturnType<'GetOrgDiffScan'>['data'] | undefined> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching diff-scan...')

  const response = await queryApi(
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
    apiToken
  )

  spinner?.successAndStop('Received diff-scan response')

  if (!response.ok) {
    const err = await handleApiError(response.status)
    spinner.errorAndStop(
      `${colors.bgRed(colors.white(response.statusText))}: ${err}`
    )
    return
  }

  const result = await handleApiCall(
    (await response.json()) as Promise<
      SocketSdkReturnType<'GetOrgDiffScan'>['data']
    >,
    'Deserializing json'
  )

  return result
}
