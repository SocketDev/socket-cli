import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchAuditLogsConfig = {
  logType: string
  orgSlug: string
  outputKind: OutputKind
  page: number
  perPage: number
}

export type FetchAuditLogOptions = {
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchAuditLog(
  config: FetchAuditLogsConfig,
  options?: FetchAuditLogOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>> {
  const { sdkOptions } = { __proto__: null, ...options } as FetchAuditLogOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const { logType, orgSlug, outputKind, page, perPage } = {
    __proto__: null,
    ...config,
  } as FetchAuditLogsConfig

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
    { desc: `audit log for ${orgSlug}` },
  )
}
