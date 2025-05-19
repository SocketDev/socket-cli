import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const { REDACTED } = constants

export async function outputAuditLog(
  auditLogs: CResult<SocketSdkReturnType<'getAuditLogEvents'>['data']>,
  {
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
  },
): Promise<void> {
  if (!auditLogs.ok) {
    process.exitCode = auditLogs.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(
      await outputAsJson(auditLogs, {
        logType,
        orgSlug,
        page,
        perPage,
      }),
    )
  } else if (outputKind !== 'markdown' && !auditLogs.ok) {
    logger.fail(failMsgWithBadge(auditLogs.message, auditLogs.cause))
  } else {
    logger.log(
      await outputAsMarkdown(auditLogs, {
        logType,
        orgSlug,
        page,
        perPage,
      }),
    )
  }
}

export async function outputAsJson(
  auditLogs: CResult<SocketSdkReturnType<'getAuditLogEvents'>['data']>,
  {
    logType,
    orgSlug,
    page,
    perPage,
  }: {
    orgSlug: string
    page: number
    perPage: number
    logType: string
  },
): Promise<string> {
  if (!auditLogs.ok) {
    return serializeResultJson(auditLogs)
  }

  return serializeResultJson({
    ok: true,
    data: {
      desc: 'Audit logs for given query',
      // Lazily access constants.ENV.VITEST.
      generated: constants.ENV.VITEST ? REDACTED : new Date().toISOString(),
      org: orgSlug,
      logType,
      page,
      nextPage: auditLogs.data.nextPage,
      perPage,
      logs: auditLogs.data.results.map(log => {
        // Note: The subset is pretty arbitrary
        const {
          created_at,
          event_id,
          ip_address,
          type,
          user_agent,
          user_email,
        } = log
        return {
          event_id,
          created_at,
          ip_address,
          type,
          user_agent,
          user_email,
        }
      }),
    },
  })
}

export async function outputAsMarkdown(
  auditLogs: CResult<SocketSdkReturnType<'getAuditLogEvents'>['data']>,
  {
    logType,
    orgSlug,
    page,
    perPage,
  }: {
    orgSlug: string
    page: number
    perPage: number
    logType: string
  },
): Promise<string> {
  if (!auditLogs.ok) {
    return `
# Socket Audit Logs

There was a problem fetching the audit logs:

> ${auditLogs.message}
${
  auditLogs.cause
    ? '>\n' +
      (
        auditLogs.cause
          .split('\n')
          .map(s => `> ${s}\n`)
          .join('') ?? ''
      )
    : ''
}
Parameters:

- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- per page: ${perPage}
`
  }

  try {
    const table = mdTable<any>(auditLogs.data.results, [
      'event_id',
      'created_at',
      'type',
      'user_email',
      'ip_address',
      'user_agent',
    ])

    return `
# Socket Audit Logs

These are the Socket.dev audit logs as per requested query.
- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- next page: ${auditLogs.data.nextPage}
- per page: ${perPage}
- generated: ${constants.ENV.VITEST ? REDACTED : new Date().toISOString()}

${table}
`
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was a problem converting the logs to Markdown, please try the `--json` flag',
    )
    if (isDebug()) {
      debugLog('Error:\n', e)
    }
    // logger.error(e)
    return ''
  }
}
