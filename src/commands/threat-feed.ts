import process from 'node:process'

// @ts-ignore
import ScreenWidget from 'blessed/lib/widgets/screen'
// @ts-ignore
import TableWidget from 'blessed-contrib/lib/widget/table'
import meow from 'meow'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags } from '../flags'
import { queryAPI } from '../utils/api'
import { AuthError } from '../utils/errors'
import { getFlagListOutput } from '../utils/output-formatting'
import { getDefaultToken } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const threatFeed: CliSubcommand = {
  description: 'Look up the threat feed',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} threat-feed`

    const input = setupCommand(name, threatFeed.description, argv, importMeta)
    if (input) {
      const apiToken = getDefaultToken()
      if (!apiToken) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinner = new Spinner({
        text: 'Looking up the threat feed'
      }).start()
      await fetchThreatFeed(input, spinner, apiToken)
    }
  }
}

const threatFeedFlags = {
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Number of items per page'
  },
  page: {
    type: 'string',
    shortFlag: 'p',
    default: '1',
    description: 'Page token'
  },
  direction: {
    type: 'string',
    shortFlag: 'd',
    default: 'desc',
    description: 'Order asc or desc by the createdAt attribute.'
  },
  filter: {
    type: 'string',
    shortFlag: 'f',
    default: 'mal',
    description: 'Filter what type of threats to return'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  per_page: number
  page: string
  direction: string
  filter: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags,
    ...threatFeedFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name}

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${name}
      $ ${name} --perPage=5 --page=2 --direction=asc --filter=joke
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )

  const {
    direction,
    filter,
    json: outputJson,
    markdown: outputMarkdown,
    page,
    perPage: per_page
  } = cli.flags

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    per_page,
    page,
    direction,
    filter
  }
}

type ThreatResult = {
  createdAt: string
  description: string
  id: number
  locationHtmlUrl: string
  packageHtmlUrl: string
  purl: string
  removedAt: string
  threatType: string
}

async function fetchThreatFeed(
  { direction, filter, outputJson, page, per_page }: CommandContext,
  spinner: Spinner,
  apiToken: string
): Promise<void> {
  const formattedQueryParams = formatQueryParams({
    per_page,
    page,
    direction,
    filter
  }).join('&')
  const response = await queryAPI(
    `threat-feed?${formattedQueryParams}`,
    apiToken
  )
  const data = <{ results: ThreatResult[]; nextPage: string }>(
    await response.json()
  )

  spinner.stop()

  if (outputJson) {
    console.log(data)
    return
  }

  const screen = new ScreenWidget()

  const table = new TableWidget({
    keys: 'true',
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'magenta',
    interactive: 'true',
    label: 'Threat feed',
    width: '100%',
    height: '100%',
    border: {
      type: 'line',
      fg: 'cyan'
    },
    columnSpacing: 3, //in chars
    columnWidth: [9, 30, 10, 17, 13, 100] /*in chars*/
  })

  // allow control the table with the keyboard
  table.focus()

  screen.append(table)

  const formattedOutput = formatResults(data.results)

  table.setData({
    headers: [
      'Ecosystem',
      'Name',
      'Version',
      'Threat type',
      'Detected at',
      'Details'
    ],
    data: formattedOutput
  })

  screen.render()

  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))
}

const formatResults = (data: ThreatResult[]) => {
  return data.map(d => {
    const ecosystem = d.purl.split('pkg:')[1]!.split('/')[0]!
    const name = d.purl.split('/')[1]!.split('@')[0]!
    const version = d.purl.split('@')[1]!

    const timeStart = new Date(d.createdAt).getMilliseconds()
    const timeEnd = Date.now()

    const diff = getHourDiff(timeStart, timeEnd)
    const hourDiff =
      diff > 0
        ? `${diff} hours ago`
        : `${getMinDiff(timeStart, timeEnd)} minutes ago`

    return [
      ecosystem,
      decodeURIComponent(name),
      version,
      d.threatType,
      hourDiff,
      d.locationHtmlUrl
    ]
  })
}

const formatQueryParams = (params: object) =>
  Object.entries(params).map(entry => `${entry[0]}=${entry[1]}`)

const getHourDiff = (start: number, end: number) =>
  Math.floor((end - start) / 3600000)

const getMinDiff = (start: number, end: number) =>
  Math.floor((end - start) / 60000)
