import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function fetchAuditLog({
  logType,
  orgSlug,
  outputKind,
  page,
  perPage,
}: {
  outputKind: OutputKind
  orgSlug: string
  page: number
  perPage: number
  logType: string
}): Promise<CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(
    sockSdk.getAuditLogEvents(orgSlug, {
      // I'm not sure this is used at all.
      outputJson: String(outputKind === 'json'),
      // I'm not sure this is used at all.
      outputMarkdown: String(outputKind === 'markdown'),
      orgSlug,
      type: logType,
      page: String(page),
      per_page: String(perPage),
    }),
    `audit log for ${orgSlug}`,
  )
}
