import { logger } from '@socketsecurity/registry/lib/logger'

import { outputConfigList } from './output-config-list'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { supportedConfigKeys } from '../../utils/config'
import { getOutputKind } from '../../utils/get-output-kind'
import { checkCommandInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

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
      description: 'Show full tokens in plaintext (unsafe)'
    }
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
  `
}

export const cmdConfigList = {
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

  const { full, json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const wasBadInput = checkCommandInput(outputKind, {
    nook: true,
    test: !json || !markdown,
    message:
      'The `--json` and `--markdown` flags can not be used at the same time',
    pass: 'ok',
    fail: 'bad'
  })
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await outputConfigList({
    full: !!full,
    outputKind
  })
}
