import { logger } from '@socketsecurity/registry/lib/logger'

import { outputConfigList } from './output-config-list.mts'
import constants, { FLAG_JSON, FLAG_MARKDOWN } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'Show all local CLI config items and their values',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    full: {
      type: 'boolean',
      default: false,
      description: 'Show full tokens in plaintext (unsafe)',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options]

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
  `,
}

export const cmdConfigList = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { full, json, markdown } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: !json || !markdown,
    message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
    fail: 'bad',
  })
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await outputConfigList({
    full: !!full,
    outputKind,
  })
}
