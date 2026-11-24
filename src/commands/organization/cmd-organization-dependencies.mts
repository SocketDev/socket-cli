import { parsePurlsOption } from './dependencies-filters.mts'
import { handleDependencies } from './handle-dependencies.mts'
import constants, { FLAG_JSON, FLAG_MARKDOWN } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { InputError } from '../../utils/errors.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { logger } from '../../utils/logger.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'dependencies'

const description =
  'Search for any dependency that is being used in your organization'

const hidden = false

export const cmdOrganizationDependencies = {
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
      limit: {
        type: 'number',
        default: 50,
        description: 'Maximum number of dependencies returned',
      },
      offset: {
        type: 'number',
        default: 0,
        description: 'Number of dependencies to skip',
      },
      purls: {
        type: 'string',
        isMultiple: true,
        description:
          'Search by PURL; pkg: is optional. Comma-separate values or repeat this flag',
      },
      ...outputFlags,
    },
    help: (command, config) => `
    Usage
      ${command} [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      ${command}
      ${command} --limit 20 --offset 10
      ${command} --purls 'npm/minimist@0.0.4,pkg:pypi/requests'
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const { json, limit, markdown, offset, purls: suppliedPurls } = cli.flags
  const parsedPurls = parsePurlsOption(argv, suppliedPurls)
  if (!parsedPurls.ok) {
    throw new InputError(parsedPurls.message)
  }
  const { purls } = parsedPurls

  const dryRun = !!cli.flags['dryRun']

  const hasApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !json || !markdown,
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
      fail: 'bad',
    },
    {
      nook: true,
      test: dryRun || hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleDependencies({
    limit: Number(limit || 0) || 0,
    offset: Number(offset || 0) || 0,
    outputKind,
    purls,
  })
}
