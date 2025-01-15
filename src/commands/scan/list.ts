// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { printFlagList } from '../../utils/formatting'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

export const list: CliSubcommand = {
  description: 'List scans for an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} list`
    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultToken()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Listing scans... \n'
      const spinner = new Spinner({ text: spinnerText }).start()
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
    ...commonFlags,
    ...listFullScanFlags,
    ...outputFlags
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
  let showHelp = cli.flags['help']
  if (!cli.input[0]) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please specify an organization slug.`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const { 0: orgSlug = '' } = cli.input
  return <CommandContext>{
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    orgSlug,
    sort: cli.flags['sort'],
    direction: cli.flags['direction'],
    per_page: cli.flags['perPage'],
    page: cli.flags['page'],
    from_time: cli.flags['fromTime'],
    until_time: cli.flags['untilTime']
  }
}

async function listOrgFullScan(
  orgSlug: string,
  input: CommandContext,
  spinner: Spinner,
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

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'report_url', name: colors.magenta('Scan URL') },
      { field: 'branch', name: colors.magenta('Branch') },
      { field: 'created_at', name: colors.magenta('Created at') }
    ]
  }

  const formattedResults = result.data.results.map(d => {
    return {
      id: d.id,
      report_url: colors.underline(`${d.html_report_url}`),
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

  spinner.stop(`Listing scans for: ${orgSlug}`)
  console.log(chalkTable(options, formattedResults))
}
