import { logger } from '@socketsecurity/registry/lib/logger'
import { Separator, select } from '@socketsecurity/registry/lib/prompts'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { Choice } from '@socketsecurity/registry/lib/prompts'

type AuditChoice = Choice<string>

type AuditChoices = Array<Separator | AuditChoice>

export async function getAuditLog({
  apiToken,
  orgSlug,
  outputJson,
  outputMarkdown,
  page,
  perPage,
  type
}: {
  apiToken: string
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  page: number
  perPage: number
  type: string
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Looking up audit log for ${orgSlug}`)

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getAuditLogEvents(orgSlug, {
      outputJson,
      outputMarkdown,
      orgSlug,
      type,
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

  const data: AuditChoices = []
  const logDetails: { [key: string]: string } = {}

  for (const d of result.data.results) {
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
        message: type
          ? `\n Audit log for: ${orgSlug} with type: ${type}\n`
          : `\n Audit log for: ${orgSlug}\n`,
        choices: data,
        pageSize: 30
      })) as any
    ]
  )
}
