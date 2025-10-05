/** @fileoverview Audit log data fetching for Socket CLI. Retrieves paginated audit log events from the Socket API with filtering support for event types and time ranges. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchAuditLogsConfig = {
  logType: string
  orgSlug: string
  outputKind: OutputKind
  page: number
  perPage: number
}

export type FetchAuditLogOptions = BaseFetchOptions

export async function fetchAuditLog(
  config: FetchAuditLogsConfig,
  options?: FetchAuditLogOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>> {
  const { logType, orgSlug, outputKind, page, perPage } = {
    __proto__: null,
    ...config,
  } as FetchAuditLogsConfig

  return await withSdk(
    sdk =>
      sdk.getAuditLogEvents(orgSlug, {
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
    options,
  )
}
