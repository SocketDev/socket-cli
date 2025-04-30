import constants from '../../constants.mts'
import { handleApiCall, handleFailedApiResponse } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchAuditLog({
  logType,
  orgSlug,
  outputKind,
  page,
  perPage
}: {
  outputKind: OutputKind
  orgSlug: string
  page: number
  perPage: number
  logType: string
}): Promise<CResult<SocketSdkReturnType<'getAuditLogEvents'>['data']>> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Looking up audit log for ${orgSlug}`)

  const result = await handleApiCall(
    sockSdk.getAuditLogEvents(orgSlug, {
      // I'm not sure this is used at all.
      outputJson: String(outputKind === 'json'),
      // I'm not sure this is used at all.
      outputMarkdown: String(outputKind === 'markdown'),
      orgSlug,
      type: logType,
      page: String(page),
      per_page: String(perPage)
    }),
    `Looking up audit log for ${orgSlug}\n`
  )

  spinner.successAndStop(`Received API response.`)

  if (!result.success) {
    return handleFailedApiResponse('getAuditLogEvents', result)
  }

  return {
    ok: true,
    data: result.data
  }
}
