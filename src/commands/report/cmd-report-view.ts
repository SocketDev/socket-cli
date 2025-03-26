import { logger } from '@socketsecurity/registry/lib/logger'

import { viewReport } from './view-report'
import constants from '../../constants'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
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

  const { json, markdown } = cli.flags
  const [reportId = '', ...extraInput] = cli.input

  const wasBadInput = handleBadInput(
    {
      test: reportId,
      message: 'Need at least one report ID',
      pass: 'ok',
      fail: 'missing'
    },
    {
      hide: extraInput.length === 0,
      test: extraInput.length === 0,
      message: 'Can only handle a single report ID',
      pass: 'ok',
      fail: 'received ' + (extraInput.length + 1)
    },
    {
      hide: !json || !markdown,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    }
  )
  if (wasBadInput) return

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await viewReport(reportId, {
    all: Boolean(cli.flags['all']),
    commandName: `${parentName} ${config.commandName}`,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    strict: Boolean(cli.flags['strict'])
  })
}
