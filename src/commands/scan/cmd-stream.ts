import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { getFullScan } from './get-full-scan.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'stream',
  description: 'Stream the output of a scan',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} <org slug> <scan ID> [path to output file]

    When no output path is given the contents is sent to stdout.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 ./stream.txt
  `
}

export const cmdScanStream: CliSubcommand = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meow(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  const [orgSlug = '', fullScanId = '', file = '-'] = cli.input

  if (!orgSlug || !fullScanId) {
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Full Scan ID to fetch as second argument ${!fullScanId ? colors.red('(missing!)') : colors.green('(ok)')}
    `
    )
    config.help(parentName, config)
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await getFullScan(orgSlug, fullScanId, file, apiToken)
}
