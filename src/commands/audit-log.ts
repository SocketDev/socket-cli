import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Separator, select } from '@socketsecurity/registry/lib/prompts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags } from '../flags'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../utils/api'
import { AuthError } from '../utils/errors'
import { getFlagListOutput } from '../utils/output-formatting'
import { getDefaultToken, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const description = 'Look up the audit log for an organization'

export const auditLogCommand: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' audit-log'

    const input = setupCommand(name, description, argv, importMeta)
    if (input) {
      const apiToken = getDefaultToken()
      if (!apiToken) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinner = new Spinner({
        text: `Looking up audit log for ${input.orgSlug}\n`
      }).start()
      await fetchOrgAuditLog(input.orgSlug, input, spinner, apiToken)
    }
  }
}

const auditLogFlags: { [key: string]: any } = {
  type: {
    type: 'string',
    shortFlag: 't',
    default: '',
    description: 'Type of log event'
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Results per page - default is 30'
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number - default is 1'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  type: string
  page: number
  per_page: number
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...auditLogFlags,
    ...commonFlags,
    ...outputFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} <org slug>

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${name} FakeOrg
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  let showHelp = cli.flags['help']
  if (cli.input.length < 1) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide an organization slug.`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const {
    json: outputJson,
    markdown: outputMarkdown,
    page,
    perPage
  } = cli.flags
  const type = <string>cli.flags['type']
  const { 0: orgSlug = '' } = cli.input
  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    type: type && type.charAt(0).toUpperCase() + type.slice(1),
    page,
    per_page: perPage
  }
}

type Choice<Value> = {
  value: Value
  name?: string
  description?: string
  disabled?: boolean | string
  type?: never
}

type AuditChoice = Choice<string>

type AuditChoices = (Separator | AuditChoice)[]

async function fetchOrgAuditLog(
  orgSlug: string,
  input: CommandContext,
  spinner: Spinner,
  apiToken: string
): Promise<void> {
  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getAuditLogEvents(orgSlug, input),
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

  console.log(
    logDetails[
      (await select({
        message: input.type
          ? `\n Audit log for: ${orgSlug} with type: ${input.type}\n`
          : `\n Audit log for: ${orgSlug}\n`,
        choices: data,
        pageSize: 30
      })) as any
    ]
  )
}
