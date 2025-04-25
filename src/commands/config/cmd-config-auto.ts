import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigAuto } from './handle-config-auto'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { supportedConfigKeys } from '../../utils/config'
import { getOutputKind } from '../../utils/get-output-kind'
import { checkCommandInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { LocalConfig } from '../../utils/config'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'auto',
  description: 'Automatically discover and set the correct value config item',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Attempt to automatically discover the correct value for a certain config key.

    For certain keys it will request the value from server, for others it will
    reset the value to the default. For some keys this has no effect.

    Keys:

${Array.from(supportedConfigKeys.entries())
  .map(([key, desc]) => `     - ${key} -- ${desc}`)
  .join('\n')}

    Examples
      $ ${command} auto defaultOrg
  `
}

export const cmdConfigAuto = {
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

  const { json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const [key = ''] = cli.input

  const wasBadInput = checkCommandInput(
    outputKind,
    outputKind,
    {
      test: supportedConfigKeys.has(key as keyof LocalConfig) && key !== 'test',
      message: 'Config key should be the first arg',
      pass: 'ok',
      fail: key ? 'invalid config key' : 'missing'
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleConfigAuto({
    key: key as keyof LocalConfig,
    outputKind
  })
}
