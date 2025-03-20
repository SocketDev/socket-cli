import { fetchAuditLog } from './fetch-audit-log'
import { outputAuditLog } from './output-audit-log'

export async function handleAuditLog({
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
}): Promise<void> {
  const auditLogs = await fetchAuditLog({
    orgSlug,
    outputKind,
    page,
    perPage,
    logType
  })
  if (!auditLogs) return

  await outputAuditLog(auditLogs, {
    logType,
    orgSlug,
    outputKind,
    page,
    perPage
  })
}
