import { logger } from '@socketsecurity/registry/lib/logger'

import { handleQuota } from './handle-quota.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { checkCommandInput } from '../../utils/handle-bad-input.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'quota',
  description: 'List organizations associated with the API key used',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdOrganizationQuota = {
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

  const json = Boolean(cli.flags['json'])
  const markdown = Boolean(cli.flags['markdown'])
  const outputKind = getOutputKind(json, markdown)

  const apiToken = getDefaultToken()

  const wasBadInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    },
    {
      nook: true,
      test: !!apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleQuota(outputKind)
}
