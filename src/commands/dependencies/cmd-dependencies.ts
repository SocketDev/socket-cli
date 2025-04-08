import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDependencies } from './handle-dependencies'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'dependencies',
  description:
    'Search for any dependency that is being used in your organization',
  hidden: false,
  flags: {
    ...commonFlags,
    limit: {
      type: 'number',
      shortFlag: 'l',
      default: 50,
      description: 'Maximum number of dependencies returned'
    },
    offset: {
      type: 'number',
      shortFlag: 'o',
      default: 0,
      description: 'Page number'
    },
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      ${command}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: none (does need token with access to target org)

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      ${command} --limit 20 --offset 10
  `
}

export const cmdScanCreate = {
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

  const { json, limit, markdown, offset } = cli.flags

  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
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

  await handleDependencies({
    limit: Number(limit || 0) || 0,
    offset: Number(offset || 0) || 0,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text'
  })
}
