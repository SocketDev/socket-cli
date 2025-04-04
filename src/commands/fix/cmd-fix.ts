import { logger } from '@socketsecurity/registry/lib/logger'

import { runFix } from './run-fix'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Fix "fixable" Socket alerts',
  hidden: true,
  flags: {
    ...commonFlags,
    test: {
      type: 'boolean',
      default: true,
      description: 'Very the fix by running unit tests'
    },
    testScript: {
      type: 'string',
      default: 'test',
      description: 'The test script to run for each fix attempt'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdFix = {
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

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  await runFix({
    spinner,
    test: Boolean(cli.flags['test']),
    testScript: cli.flags['testScript'] as string | undefined
  })
}
