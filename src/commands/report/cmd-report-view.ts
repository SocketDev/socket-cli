import meowOrExit from 'meow'
import colors from 'yoctocolors-cjs'

import { viewReport } from './view-report.ts'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
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
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} <report-identifier>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
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
  const cli = meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags,
    allowUnknownFlags: false
  })

  const [reportId, ...extraInput] = cli.input

  // Validate the input.
  if (extraInput.length || !reportId) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Need at least one report ID ${!reportId ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Can only handle a single report ID ${extraInput.length < 2 ? colors.red(`(received ${extraInput.length}!)`) : colors.green('(ok)')}\n
    `)
    cli.showHelp()
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
