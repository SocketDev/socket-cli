import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigAuto } from './handle-config-auto.mts'
import {
  DRY_RUN_BAILING_NOW,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getSupportedConfigEntries,
  isSupportedConfigKey,
} from '../../utils/config.mts'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import type { LocalConfig } from '../../utils/config.mts'

export const CMD_NAME = 'auto'

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
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
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
  .map(({ 0: key, 1: description }) => `     - ${key} -- ${description}`)
  .join('\n')}
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown } = cli.flags as unknown as {
    json: boolean
    markdown: boolean
  }

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
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
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
