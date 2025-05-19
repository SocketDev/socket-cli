import { logger } from '@socketsecurity/registry/lib/logger'

import { applyOptimization } from './apply-optimization.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'optimize',
  description: 'Optimize dependencies with @socketregistry overrides',
  hidden: false,
  flags: {
    ...commonFlags,
    pin: {
      type: 'boolean',
      default: false,
      description: 'Pin overrides to their latest version',
    },
    prod: {
      type: 'boolean',
      default: false,
      description: 'Only add overrides for production dependencies',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} --pin
  `,
}

export const cmdOptimize = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  // TODO: impl json/md

  const cwd = process.cwd()

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await applyOptimization(
    cwd,
    Boolean(cli.flags['pin']),
    Boolean(cli.flags['prod']),
  )
}
