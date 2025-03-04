import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getOrgScanMetadata } from './get-full-scan-metadata'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

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
  argv: string[] | readonly string[],
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
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(
      stripIndents`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}

      - Full Scan ID to inspect as second argument ${!fullScanId ? colors.red('(missing!)') : colors.green('(ok)')}`
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await getOrgScanMetadata(
    orgSlug,
    fullScanId,
    cli.flags['json'] ? 'json' : cli.flags['markdown'] ? 'markdown' : 'print'
  )
}
