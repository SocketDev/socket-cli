import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchAuditLogsConfig = {
  logType: string
  orgSlug: string
  outputKind: OutputKind
  page: number
  perPage: number
}

export type FetchAuditLogOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchAuditLog(
  config: FetchAuditLogsConfig,
  options?: FetchAuditLogOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>> {
  const { sdkOpts } = { __proto__: null, ...options } as FetchAuditLogOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const { logType, orgSlug, outputKind, page, perPage } = {
    __proto__: null,
    ...config,
  } as FetchAuditLogsConfig

  return await handleApiCall<'getAuditLogEvents'>(
    sockSdk.getAuditLogEvents(orgSlug, {
      // I'm not sure this is used at all.
      outputJson: outputKind === 'json',
      // I'm not sure this is used at all.
      outputMarkdown: outputKind === 'markdown',
      orgSlug,
      type: logType,
      page,
      per_page: perPage,
    }),
    { description: `audit log for ${orgSlug}` },
  )
}
