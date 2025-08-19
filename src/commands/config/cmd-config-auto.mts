import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigAuto } from './handle-config-auto.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import {
  getSupportedConfigEntries,
  isSupportedConfigKey,
} from '../../utils/config.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { LocalConfig } from '../../utils/config.mts'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const description =
  'Automatically discover and set the correct value config item'

const hidden = false

export const cmdConfigAuto = {
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
    commandName: 'auto',
    description,
    hidden,
    flags: {
      ...commonFlags,
      ...outputFlags,
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] KEY

    Options
      ${getFlagListOutput(config.flags)}

    Attempt to automatically discover the correct value for a given config KEY.

    Examples
      $ ${command} defaultOrg

    Keys:
${getSupportedConfigEntries()
  .map(([key, desc]) => `     - ${key} -- ${desc}`)
  .join('\n')}
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const [key = ''] = cli.input

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: key !== 'test' && isSupportedConfigKey(key),
      message: 'Config key should be the first arg',
      fail: key ? 'invalid config key' : 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleConfigAuto({
    key: key as keyof LocalConfig,
    outputKind,
  })
}
