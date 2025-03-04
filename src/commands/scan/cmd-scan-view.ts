import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { streamFullScan } from './stream-full-scan'
import { viewFullScan } from './view-full-scan'
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
  commandName: 'view',
  description: 'View the raw results of a scan',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug> <scan ID> [path to output file]

    When no output path is given the contents is sent to stdout.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 ./stream.txt
  `
}

export const cmdScanView: CliSubcommand = {
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

  const [orgSlug = '', fullScanId = '', file = '-'] = cli.input

  if (!orgSlug || !fullScanId) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      stripIndents`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}

      - Full Scan ID to fetch as second argument ${!fullScanId ? colors.red('(missing!)') : colors.green('(ok)')}
    `
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  if (cli.flags['json']) {
    await streamFullScan(orgSlug, fullScanId, file)
  } else {
    await viewFullScan(orgSlug, fullScanId, file)
  }
}
