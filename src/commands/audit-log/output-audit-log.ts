import process from 'node:process'

import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { mdTable } from '../../utils/markdown'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const { REDACTED } = constants

export async function outputAuditLog(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data'],
  {
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
  }
): Promise<void> {
  if (outputKind === 'json') {
    logger.log(
      await outputAsJson(auditLogs.results, {
        logType,
        orgSlug,
        page,
        perPage
      })
    )
  } else {
    logger.log(
      await outputAsMarkdown(auditLogs.results, {
        logType,
        orgSlug,
        page,
        perPage
      })
    )
  }
}

export async function outputAsJson(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data']['results'],
  {
    logType,
    orgSlug,
    page,
    perPage
  }: {
    orgSlug: string
    page: number
    perPage: number
    logType: string
  }
): Promise<string> {
  let json
  try {
    json = JSON.stringify(
      {
        desc: 'Audit logs for given query',
        generated: process.env['VITEST'] ? REDACTED : new Date().toISOString(),
        org: orgSlug,
        logType,
        page,
        perPage,
        logs: auditLogs.map(log => {
          // Note: The subset is pretty arbitrary
          const {
            created_at,
            event_id,
            ip_address,
            type,
            user_agent,
            user_email
          } = log
          return {
            event_id,
            created_at,
            ip_address,
            type,
            user_agent,
            user_email
          }
        })
      },
      null,
      2
    )
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was a problem converting the logs to JSON, please try without the `--json` flag'
    )
    if (isDebug()) {
      debugLog('Error:', e)
    }
    return '{}'
  }

  return json
}

export async function outputAsMarkdown(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data']['results'],
  {
    logType,
    orgSlug,
    page,
    perPage
  }: {
    orgSlug: string
    page: number
    perPage: number
    logType: string
  }
): Promise<string> {
  try {
    const table = mdTable<any>(auditLogs, [
      'event_id',
      'created_at',
      'type',
      'user_email',
      'ip_address',
      'user_agent'
    ])

    return `
# Socket Audit Logs

These are the Socket.dev audit logs as per requested query.
- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- per page: ${perPage}
- generated: ${process.env['VITEST'] ? REDACTED : new Date().toISOString()}

${table}
`
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was a problem converting the logs to Markdown, please try the `--json` flag'
    )
    if (isDebug()) {
      debugLog('Error:', e)
    }
    // logger.error(e)
    return ''
  }
}
