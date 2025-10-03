/** @fileoverview Config set command for Socket CLI. Sets and persists configuration values to the config file. Validates config keys and provides feedback on success/failure. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigSet } from './handle-config-set.mts'
import constants, { FLAG_JSON, FLAG_MARKDOWN } from '../../constants.mts'
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
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

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
      // example.com
      $ ${command} apiProxy https:
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
      // This is a string, empty string is not ok
      test: !!value,
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
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleConfigSet({
    key: key as keyof LocalConfig,
    outputKind,
    value,
  })
}
