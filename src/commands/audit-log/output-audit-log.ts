import { stripIndents } from 'common-tags'

import { logger } from '@socketsecurity/registry/lib/logger'
import { Separator, select } from '@socketsecurity/registry/lib/prompts'

import { mdTable } from '../../utils/markdown'

import type { Choice } from '@socketsecurity/registry/lib/prompts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type AuditChoice = Choice<string>

type AuditChoices = Array<Separator | AuditChoice>

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
    await outputAsJson(auditLogs.results, orgSlug, logType, page, perPage)
  } else if (outputKind === 'markdown') {
    await outputAsMarkdown(auditLogs.results, orgSlug, logType, page, perPage)
  } else {
    await outputAsPrint(auditLogs.results, orgSlug, logType)
  }
}

async function outputAsJson(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data']['results'],
  orgSlug: string,
  logType: string,
  page: number,
  perPage: number
): Promise<void> {
  let json
  try {
    json = JSON.stringify(
      {
        desc: 'Audit logs for given query',
        generated: new Date().toISOString(),
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
    return
  }

  logger.log(json)
}

export async function outputAsMarkdown(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data']['results'],
  orgSlug: string,
  logType: string,
  page: number,
  perPage: number
): Promise<void> {
  try {
    const table = mdTable<any>(auditLogs, [
      'event_id',
      'created_at',
      'type',
      'user_email',
      'ip_address',
      'user_agent'
    ])

    logger.log(
      stripIndents`
# Socket Audit Logs

These are the Socket.dev audit logs as per requested query.
- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- per page: ${perPage}
- generated: ${new Date().toISOString()}

${table}
`
    )
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was a problem converting the logs to JSON, please try without the `--json` flag'
    )
    logger.error(e)
    return
  }
}

async function outputAsPrint(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data']['results'],
  orgSlug: string,
  logType: string
): Promise<void> {
  const data: AuditChoices = []
  const logDetails: { [key: string]: string } = {}

  for (const d of auditLogs) {
    const { created_at } = d
    if (created_at) {
      const name = `${new Date(created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'numeric', day: 'numeric' })} - ${d.user_email} - ${d.type} - ${d.ip_address} - ${d.user_agent}`
      data.push({ name } as AuditChoice, new Separator())
      logDetails[name] = JSON.stringify(d.payload)
    }
  }

  logger.log(
    logDetails[
      (await select({
        message: logType
          ? `\n Audit log for: ${orgSlug} with type: ${logType}\n`
          : `\n Audit log for: ${orgSlug}\n`,
        choices: data,
        pageSize: 30
      })) as any
    ]
  )
}
