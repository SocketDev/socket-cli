import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { handleOptimize } from './handle-optimize.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

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
  { parentName }: CliCommandContext,
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
        description: 'Pin overrides to latest version',
      },
      prod: {
        type: 'boolean',
        default: false,
        description: 'Add overrides for production dependencies only',
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
      $ ${command} ./path/to/project --pin
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
    getDefaultLogger().log(DRY_RUN_BAILING_NOW)
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
