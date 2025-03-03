import { logger } from '@socketsecurity/registry/lib/logger'
import { Separator, select } from '@socketsecurity/registry/lib/prompts'
import { SocketSdkReturnType } from '@socketsecurity/sdk'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { Choice } from '@socketsecurity/registry/lib/prompts'

type AuditChoice = Choice<string>

type AuditChoices = (Separator | AuditChoice)[]

export async function getAuditLog({
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
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  const auditLogs = await getAuditLogWithToken({
    apiToken,
    orgSlug,
    outputKind,
    page,
    perPage,
    logType
  })
  if (!auditLogs) return

  if (outputKind === 'json')
    await outputAsJson(auditLogs.results, orgSlug, logType, page, perPage)
  else if (outputKind === 'markdown')
    await outputAsMarkdown(auditLogs.results, orgSlug, logType, page, perPage)
  else await outputAsPrint(auditLogs.results, orgSlug, logType)
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
    logger.error(
      'There was a problem converting the logs to JSON, please try without the `--json` flag'
    )
    process.exitCode = 1
    return
  }

  logger.log(json)
}

async function outputAsMarkdown(
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data']['results'],
  orgSlug: string,
  logType: string,
  page: number,
  perPage: number
): Promise<void> {
  let md
  try {
    const table = mdTable(auditLogs, [
      'event_id',
      'created_at',
      'type',
      'user_email',
      'ip_address',
      'user_agent'
    ])

    md =
      `
# Socket Audit Logs

These are the Socket.dev audit logs as per requested query.
- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- per page: ${perPage}
- generated: ${new Date().toISOString()}

${table}
      `.trim() + '\n'
  } catch (e) {
    logger.error(
      'There was a problem converting the logs to JSON, please try without the `--json` flag'
    )
    logger.error(e)
    process.exitCode = 1
    return
  }

  logger.log(md)
}

function mdTable<
  T extends SocketSdkReturnType<'getAuditLogEvents'>['data']['results']
>(
  logs: T,
  // This is saying "an array of strings and the strings are a valid key of elements of T"
  // In turn, T is defined above as the audit log event type from our OpenAPI docs.
  cols: Array<string & keyof T[number]>
): string {
  // Max col width required to fit all data in that column
  const cws = cols.map(col => col.length)

  for (const log of logs) {
    for (let i = 0; i < cols.length; ++i) {
      // @ts-ignore
      const val: unknown = log[cols[i] ?? ''] ?? ''
      cws[i] = Math.max(cws[i] ?? 0, String(val).length)
    }
  }

  let div = '|'
  for (const cw of cws) div += ' ' + '-'.repeat(cw) + ' |'

  let header = '|'
  for (let i = 0; i < cols.length; ++i)
    header += ' ' + String(cols[i]).padEnd(cws[i] ?? 0, ' ') + ' |'

  let body = ''
  for (const log of logs) {
    body += '|'
    for (let i = 0; i < cols.length; ++i) {
      // @ts-ignore
      const val: unknown = log[cols[i] ?? ''] ?? ''
      body += ' ' + String(val).padEnd(cws[i] ?? 0, ' ') + ' |'
    }
    body += '\n'
  }

  return [div, header, div, body.trim(), div].filter(s => !!s.trim()).join('\n')
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
      data.push(<AuditChoice>{ name }, new Separator())
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

async function getAuditLogWithToken({
  apiToken,
  logType,
  orgSlug,
  outputKind,
  page,
  perPage
}: {
  apiToken: string
  outputKind: 'json' | 'markdown' | 'print'
  orgSlug: string
  page: number
  perPage: number
  logType: string
}): Promise<SocketSdkReturnType<'getAuditLogEvents'>['data'] | void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Looking up audit log for ${orgSlug}`)

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getAuditLogEvents(orgSlug, {
      outputJson: outputKind === 'json', // I'm not sure this is used at all
      outputMarkdown: outputKind === 'markdown', // I'm not sure this is used at all
      orgSlug,
      type: logType,
      page,
      per_page: perPage
    }),
    `Looking up audit log for ${orgSlug}\n`
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getAuditLogEvents', result, spinner)
    return
  }

  spinner.stop()

  return result.data
}
