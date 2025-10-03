/** @fileoverview Audit log business logic handler for Socket CLI. Orchestrates fetching audit log data and delegating to appropriate output formatter (JSON, markdown, text, or interactive TUI). */

import { fetchAuditLog } from './fetch-audit-log.mts'
import { outputAuditLog } from './output-audit-log.mts'

import type { OutputKind } from '../../types.mts'

export async function handleAuditLog({
  logType,
  orgSlug,
  outputKind,
  page,
  perPage,
}: {
  logType: string
  outputKind: OutputKind
  orgSlug: string
  page: number
  perPage: number
}): Promise<void> {
  const auditLogs = await fetchAuditLog({
    logType,
    orgSlug,
    outputKind,
    page,
    perPage,
  })

  await outputAuditLog(auditLogs, {
    logType,
    orgSlug,
    outputKind,
    page,
    perPage,
  })
}
