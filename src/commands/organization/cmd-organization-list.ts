import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOrganizationList } from './handle-organization-list'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getOutputKind } from '../../utils/get-output-kind'
import { checkCommandInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List organizations associated with the API key used',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: none (does need a token)

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdOrganizationList = {
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

  const apiToken = getDefaultToken()

  const wasBadInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
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
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleOrganizationList(outputKind)
}
