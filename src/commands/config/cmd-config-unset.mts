import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigUnset } from './handle-config-unset.mts'
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
  commandName: 'unset',
  description: 'Clear the value of a local CLI config item',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Keys:

${Array.from(supportedConfigKeys.entries())
  .map(([key, desc]) => `     - ${key} -- ${desc}`)
  .join('\n')}

    Examples
      $ ${command} FakeOrg --repoName=test-repo
  `,
}

export const cmdConfigUnset = {
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

  const [key = ''] = cli.input

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: key === 'test' || supportedConfigKeys.has(key as keyof LocalConfig),
      message: 'Config key should be the first arg',
      pass: 'ok',
      fail: key ? 'invalid config key' : 'missing',
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

  await handleConfigUnset({
    key: key as keyof LocalConfig,
    outputKind,
  })
}
