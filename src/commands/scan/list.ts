import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'
import { AuthError } from '../../utils/errors'

export const list: CliSubcommand = {
  description: 'List scans for an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} list`
    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if(!apiKey){
        throw new AuthError("User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.")
      }
      const spinnerText = 'Listing scans... \n'
      const spinner = ora(spinnerText).start()
      await listOrgFullScan(input.orgSlug, input, spinner, apiKey)
    }
  }
}

const listFullScanFlags: { [key: string]: any } = {
  sort: {
    type: 'string',
    shortFlag: 's',
    default: 'created_at',
    description:
      'Sorting option (`name` or `created_at`) - default is `created_at`'
  },
  direction: {
    type: 'string',
    shortFlag: 'd',
    default: 'desc',
    description: 'Direction option (`desc` or `asc`) - Default is `desc`'
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Results per page - Default is 30'
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number - Default is 1'
  },
  fromTime: {
    type: 'string',
    shortFlag: 'f',
    default: '',
    description: 'From time - as a unix timestamp'
  },
  untilTime: {
    type: 'string',
    shortFlag: 'u',
    default: '',
    description: 'Until time - as a unix timestamp'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  sort: string
  direction: string
  per_page: number
  page: number
  from_time: string
  until_time: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...outputFlags,
    ...listFullScanFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name} <org slug>

    Options
      ${printFlagList(flags, 6)}

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

  const {
    json: outputJson,
    markdown: outputMarkdown,
    sort,
    direction,
    perPage,
    page,
    fromTime,
    untilTime
  } = cli.flags

  if (!cli.input[0]) {
    console.error(
      `${chalk.bgRed('Input error')}: Please specify an organization slug.\n`
    )
    cli.showHelp()
    return
  }

  const { 0: orgSlug = '' } = cli.input

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    sort,
    direction,
    per_page: perPage,
    page,
    from_time: fromTime,
    until_time: untilTime
  }
}

async function listOrgFullScan(
  orgSlug: string,
  input: CommandContext,
  spinner: Ora, 
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(
    socketSdk.getOrgFullScanList(orgSlug, input),
    'Listing scans'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
    return
  }
  spinner.stop()

  console.log(`\n Listing scans for: ${orgSlug}\n`)

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'report_url', name: chalk.magenta('Scan URL') },
      { field: 'branch', name: chalk.magenta('Branch') },
      { field: 'created_at', name: chalk.magenta('Created at') }
    ]
  }

  const formattedResults = result.data.results.map(d => {
    return {
      id: d.id,
      report_url: chalk.underline(`${d.html_report_url}`),
      created_at: d.created_at
        ? new Date(d.created_at).toLocaleDateString('en-us', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
          })
        : '',
      branch: d.branch
    }
  })

  console.log(`${chalkTable(options, formattedResults)}\n`)
}
