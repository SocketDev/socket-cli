import { fetchAuditLog } from './fetch-audit-log.mts'
import { outputAuditLog } from './output-audit-log.mts'

import type { OutputKind } from '../../types.mts'

export async function handleAuditLog({
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
}): Promise<void> {
  const auditLogs = await fetchAuditLog({
    orgSlug,
    outputKind,
    page,
    perPage,
    logType
  })

  await outputAuditLog(auditLogs, {
    logType,
    orgSlug,
    outputKind,
    page,
    perPage
  })
}
