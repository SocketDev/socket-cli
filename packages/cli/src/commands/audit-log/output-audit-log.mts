import { debug, debugDir } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  FLAG_JSON,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  REDACTED,
} from '../../constants/cli.mts'
import { VITEST } from '../../env/vitest.mts'
import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdTable } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
const logger = getDefaultLogger()

type AuditLogEvent =
  SocketSdkSuccessResult<'getAuditLogEvents'>['data']['results'][number]

export async function outputAsJson(
  auditLogs: CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>,
  {
    logType,
    orgSlug,
    page,
    perPage,
  }: {
    logType: string
    orgSlug: string
    page: number
    perPage: number
  },
): Promise<string> {
  if (!auditLogs.ok) {
    return serializeResultJson(auditLogs)
  }

  return serializeResultJson({
    ok: true,
    data: {
      desc: 'Audit logs for given query',
      generated: VITEST ? REDACTED : new Date().toISOString(),
      logType,
      nextPage: auditLogs.data.nextPage,
      org: orgSlug,
      page,
      perPage,
      logs: auditLogs.data.results.map((log: AuditLogEvent) => {
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
  auditLogs: SocketSdkSuccessResult<'getAuditLogEvents'>['data'],
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
  try {
    const table = mdTable(
      auditLogs.results as unknown as Array<Record<string, string>>,
      [
        'event_id',
        'created_at',
        'type',
        'user_email',
        'ip_address',
        'user_agent',
      ],
    )

    return `
# Socket Audit Logs

These are the Socket.dev audit logs as per requested query.
- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- next page: ${auditLogs.nextPage}
- per page: ${perPage}
- generated: ${VITEST ? REDACTED : new Date().toISOString()}

${table}
`
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      `There was a problem converting the logs to Markdown, please try the \`${FLAG_JSON}\` flag`,
    )
    debug('Markdown conversion failed')
    debugDir(e)
    return 'Failed to generate the markdown report'
  }
}

export async function outputAuditLog(
  result: CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>,
  {
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
  },
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    logger.log(
      await outputAsJson(result, {
        logType,
        orgSlug,
        page,
        perPage,
      }),
    )
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  // Default + OUTPUT_MARKDOWN: render the markdown table. (Previously
  // OUTPUT_MARKDOWN and the default branched separately, with the
  // default going through an iocraft TUI renderer; the renderer was
  // retired alongside iocraft itself, and markdown is the natural
  // plain-text fallback.)
  logger.log(
    await outputAsMarkdown(result.data, {
      logType,
      orgSlug,
      page,
      perPage,
    }),
  )
}
