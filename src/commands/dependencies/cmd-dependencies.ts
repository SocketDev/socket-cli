import { logger } from '@socketsecurity/registry/lib/logger'

import { findDependencies } from './find-dependencies'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'dependencies',
  description:
    'Search for any dependency that is being used in your organization',
  hidden: false,
  flags: {
    ...commonFlags,
    limit: {
      type: 'number',
      shortFlag: 'l',
      default: 50,
      description: 'Maximum number of dependencies returned'
    },
    offset: {
      type: 'number',
      shortFlag: 'o',
      default: 0,
      description: 'Page number'
    },
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      ${command} --limit 20 --offset 10
  `
}

export const cmdScanCreate = {
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

  // TODO: markdown flag is ignored
  await findDependencies({
    limit: Number(cli.flags['limit'] || 0) || 0,
    offset: Number(cli.flags['offset'] || 0) || 0,
    outputJson: Boolean(cli.flags['json'])
  })
}
