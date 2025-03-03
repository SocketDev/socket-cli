import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { listFullScans } from './list-full-scans'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List the full scans for an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
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
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
  `
}

export const cmdScanList: CliSubcommand = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | Readonly<string[]>,
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
) {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const orgSlug = cli.input[0]

  if (!orgSlug) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
    - Org name as the argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n`)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await listFullScans(
    orgSlug,
    // TODO: refine this object to what we need
    {
      outputJson: cli.flags['json'],
      outputMarkdown: cli.flags['markdown'],
      orgSlug,
      sort: cli.flags['sort'],
      direction: cli.flags['direction'],
      per_page: cli.flags['perPage'],
      page: cli.flags['page'],
      from_time: cli.flags['fromTime'],
      until_time: cli.flags['untilTime']
    } as {
      outputJson: boolean
      outputMarkdown: boolean
      orgSlug: string
      sort: string
      direction: string
      per_page: number
      page: number
      from_time: string
      until_time: string
    },
    apiToken
  )
}
