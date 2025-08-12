import { logger } from '@socketsecurity/registry/lib/logger'

import { outputConfigList } from './output-config-list.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

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
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { full, json, markdown } = cli.flags

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: !json || !markdown,
    message:
      'The `--json` and `--markdown` flags can not be used at the same time',
    fail: 'bad',
  })
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await outputConfigList({
    full: !!full,
    outputKind,
  })
}
