import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOptimize } from './handle-optimize.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'optimize'

const description = 'Optimize dependencies with @socketregistry overrides'

const hidden = false

export const cmdOptimize = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
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

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} ./proj/tree --pin
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const { json, markdown, pin, prod } = cli.flags

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const outputKind = getOutputKind(json, markdown)

  await handleOptimize({
    cwd,
    pin: Boolean(pin),
    outputKind,
    prod: Boolean(prod),
  })
}
