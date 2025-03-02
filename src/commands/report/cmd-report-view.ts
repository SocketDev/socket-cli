import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { viewReport } from './view-report'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'view',
  description: 'View a project report',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <report-identifier>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
  `
}

export const cmdReportView = {
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

  const [reportId, ...extraInput] = cli.input

  // Validate the input.
  if (extraInput.length || !reportId) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Need at least one report ID ${!reportId ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Can only handle a single report ID ${extraInput.length < 2 ? colors.red(`(received ${extraInput.length}!)`) : colors.green('(ok)')}\n`)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log('[DryRun] Bailing now')
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
