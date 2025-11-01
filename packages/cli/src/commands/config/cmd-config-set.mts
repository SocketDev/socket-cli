import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { handleConfigSet } from './handle-config-set.mts'
import {
  DRY_RUN_BAILING_NOW,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mjs'
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

export const CMD_NAME = 'set'

const description = 'Update the value of a local CLI config item'

const hidden = false

export const cmdConfigSet = {
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
      $ ${command} [options] <KEY> <VALUE>

    Options
      ${getFlagListOutput(config.flags)}

    This is a crude way of updating the local configuration for this CLI tool.

    Note that updating a value here is nothing more than updating a key/value
    store entry. No validation is happening. The server may reject your values
    in some cases. Use at your own risk.

    Note: use \`socket config unset\` to restore to defaults. Setting a key
    to \`undefined\` will not allow default values to be set on it.

    Keys:

${getSupportedConfigEntries()
  .map(({ 0: key, 1: description }) => `     - ${key} -- ${description}`)
  .join('\n')}

    Examples
      $ ${command} apiProxy https://example.com
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

  const [key = '', ...rest] = cli.input

  const value = rest.join(' ')

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: key === 'test' || isSupportedConfigKey(key),
      message: 'Config key should be the first arg',
      fail: key ? 'invalid config key' : 'missing',
    },
    {
      test: !!value, // This is a string, empty string is not ok
      message:
        'Key value should be the remaining args (use `unset` to unset a value)',
      fail: 'missing',
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
    getDefaultLogger().log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleConfigSet({
    key: key as keyof LocalConfig,
    outputKind,
    value,
  })
}
