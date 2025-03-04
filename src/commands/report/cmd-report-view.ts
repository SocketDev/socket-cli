import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { viewReport } from './view-report'
import constants from '../../constants'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'view',
  description: '[Deprecated] View a project report',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags
  },
  help: () => `
    This command is deprecated in favor of \`socket scan view\`.
    It will be removed in the next major release of the CLI.
  `
}

export const cmdReportView = {
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

  const [reportId, ...extraInput] = cli.input

  // Validate the input.
  if (extraInput.length || !reportId) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(stripIndents`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Need at least one report ID ${!reportId ? colors.red('(missing!)') : colors.green('(ok)')}

      - Can only handle a single report ID ${extraInput.length < 2 ? colors.red(`(received ${extraInput.length}!)`) : colors.green('(ok)')}`)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await viewReport(reportId, {
    all: Boolean(cli.flags['all']),
    commandName: `${parentName} ${config.commandName}`,
    json: Boolean(cli.flags['json']),
    markdown: Boolean(cli.flags['markdown']),
    strict: Boolean(cli.flags['strict'])
  })
}
