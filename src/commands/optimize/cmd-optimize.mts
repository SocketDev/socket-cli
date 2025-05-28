import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOptimize } from './handle-optimize.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
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
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} ./proj/tree --pin
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

  const { json, markdown } = cli.flags
  const { pin, prod } = cli.flags
  const outputKind = getOutputKind(json, markdown)
  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleOptimize({
    cwd,
    pin: Boolean(pin),
    outputKind,
    prod: Boolean(prod),
  })
}
