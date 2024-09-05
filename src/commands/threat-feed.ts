import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../flags'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { Ora } from 'ora'
import { AuthError } from '../utils/errors'
import { queryAPI } from '../utils/api-helpers'

export const threatFeed: CliSubcommand = {
  description: 'Look up the threat feed',
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' threat-feed'

    const input = setupCommand(name, threatFeed.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if(!apiKey){
        throw new AuthError("User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.")
      }
      const spinner = ora(`Looking up the threat feed \n`).start()
      await fetchThreatFeed(input, spinner, apiKey)
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
    ...threatFeedFlags,
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

  const {
    json: outputJson,
    markdown: outputMarkdown,
    perPage: per_page,
    page,
    direction,
    filter
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

async function fetchThreatFeed(
  { per_page, page, direction, filter }: CommandContext,
  spinner: Ora,
  apiKey: string
): Promise<void> {
  const formattedQueryParams = formatQueryParams({ per_page, page, direction, filter }).join('&')
  
  const response = await queryAPI(`threat-feed?${formattedQueryParams}`, apiKey)
  const data = await response.json();

  spinner.stop()
  console.log(data)
}

const formatQueryParams = (params: any) => {
  return Object.entries(params).map(entry => `${entry[0]}=${entry[1]}`)
}
