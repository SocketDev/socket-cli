import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigSet } from './handle-config-set.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { supportedConfigKeys } from '../../utils/config.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { LocalConfig } from '../../utils/config.mts'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'set',
  description: 'Update the value of a local CLI config item',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] <KEY> <VALUE>

    Options
      ${getFlagListOutput(config.flags, 6)}

    This is a crude way of updating the local configuration for this CLI tool.

    Note that updating a value here is nothing more than updating a key/value
    store entry. No validation is happening. The server may reject your values
    in some cases. Use at your own risk.

    Note: use \`socket config unset\` to restore to defaults. Setting a key
    to \`undefined\` will not allow default values to be set on it.

    Keys:

${Array.from(supportedConfigKeys.entries())
  .map(([key, desc]) => `     - ${key} -- ${desc}`)
  .join('\n')}

    Examples
      $ ${command} apiProxy https://example.com
  `,
}

export const cmdConfigSet = {
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

  const { json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const [key = '', ...rest] = cli.input
  const value = rest.join(' ')

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: key === 'test' || supportedConfigKeys.has(key as keyof LocalConfig),
      message: 'Config key should be the first arg',
      pass: 'ok',
      fail: key ? 'invalid config key' : 'missing',
    },
    {
      test: !!value, // This is a string, empty string is not ok
      message:
        'Key value should be the remaining args (use `unset` to unset a value)',
      pass: 'ok',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleConfigSet({
    key: key as keyof LocalConfig,
    outputKind,
    value,
  })
}
