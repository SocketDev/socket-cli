import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchAuditLog({
  logType,
  orgSlug,
  outputKind,
  page,
  perPage
}: {
  outputKind: 'json' | 'markdown' | 'print'
  orgSlug: string
  page: number
  perPage: number
  logType: string
}): Promise<SocketSdkReturnType<'getAuditLogEvents'>['data'] | void> {
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

  if (!result.success) {
    handleUnsuccessfulApiResponse('getAuditLogEvents', result)
    return
  }

  spinner.stop()

  return result.data
}
