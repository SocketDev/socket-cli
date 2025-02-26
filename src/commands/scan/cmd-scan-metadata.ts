import colors from 'yoctocolors-cjs'

import { getOrgScanMetadata } from './get-full-scan-metadata.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'metadata',
  description: "Get a full scan's metadata",
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug> <scan id>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0
  `
}

export const cmdScanMetadata: CliSubcommand = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const [orgSlug = '', fullScanId = ''] = cli.input

  if (!orgSlug || !fullScanId) {
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Full Scan ID to inspect as second argument ${!fullScanId ? colors.red('(missing!)') : colors.green('(ok)')}
    `
    )
    process.exitCode = 2 // bad input
    return
  }

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await getOrgScanMetadata(orgSlug, fullScanId, apiToken)
}
