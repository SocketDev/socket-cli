import { stripIndents } from 'common-tags'

import { logger } from '@socketsecurity/registry/lib/logger'
import { Separator, select } from '@socketsecurity/registry/lib/prompts'
import { SocketSdkReturnType } from '@socketsecurity/sdk'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { mdTable } from '../../utils/markdown'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { Choice } from '@socketsecurity/registry/lib/prompts'

type AuditChoice = Choice<string>

type AuditChoices = Array<Separator | AuditChoice>

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
    process.exitCode = 1
    logger.error(
      'There was a problem converting the logs to JSON, please try without the `--json` flag'
    )
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
    logger.error(
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
    handleUnsuccessfulApiResponse('getAuditLogEvents', result)
    return
  }

  spinner.stop()

  return result.data
}
