import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDependencies } from './handle-dependencies.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'dependencies',
  description:
    'Search for any dependency that is being used in your organization',
  hidden: false,
  flags: {
    ...commonFlags,
    limit: {
      type: 'number',
      default: 50,
      description: 'Maximum number of dependencies returned',
    },
    offset: {
      type: 'number',
      default: 0,
      description: 'Page number',
    },
    ...outputFlags,
  },
  help: (command, config) => `
    Usage
      ${command} [options]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: none (does need token with access to target org)

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      ${command}
      ${command} --limit 20 --offset 10
  `,
}

export const cmdOrganizationDependencies = {
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

  const { json, limit, markdown, offset } = cli.flags

  const hasApiToken = hasDefaultToken()

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad',
    },
    {
      nook: true,
      test: hasApiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleDependencies({
    limit: Number(limit || 0) || 0,
    offset: Number(offset || 0) || 0,
    outputKind,
  })
}
