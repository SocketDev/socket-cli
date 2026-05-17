import { outputConfigList } from './output-config-list.mts'
import { FLAG_JSON, FLAG_MARKDOWN } from '../../constants/cli.mjs'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const config = {
  commandName: 'list',
  description: 'Show all local CLI config items and their values',
  hidden: false,
  flags: defineFlags({
    ...commonFlags,
    ...outputFlags,
    full: {
      type: 'boolean',
      default: false,
      description: 'Show full tokens in plaintext (unsafe)',
    },
  }),
  help: (command: string, config: { flags: MeowFlags }) => `
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

export async function run(
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
    outputDryRunFetch('configuration settings', {
      showFullTokens: full ? 'yes' : 'no (masked)',
    })
    return
  }

  await outputConfigList({
    full: !!full,
    outputKind,
  })
}
