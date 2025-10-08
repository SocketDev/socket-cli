/** @fileoverview Organization list command for Socket CLI. Displays organizations associated with Socket API token. Shows organization slugs, names, and plan details in JSON, markdown, or text formats. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOrganizationList } from './handle-organization-list.mts'
import constants, { FLAG_JSON, FLAG_MARKDOWN } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
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

export const CMD_NAME = 'list'

const description = 'List organizations associated with the Socket API token'

const hidden = false

export const cmdOrganizationList = {
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
    help: (command, _config) => `
    Usage
      $ ${command} [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --json
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const { json, markdown } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const outputKind = getOutputKind(json, markdown)

  // Input validations (run even in dry-run mode)
  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: !json || !markdown,
    message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
    fail: 'bad',
  })
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  // Auth check (only in non-dry-run mode)
  const hasApiToken = hasDefaultApiToken()
  const wasValidAuth = checkCommandInput(outputKind, {
    nook: true,
    // Skip API token check in dry-run mode
    test: dryRun || hasApiToken,
    message: 'This command requires a Socket API token for access',
    fail: 'try `socket login`',
  })
  if (!wasValidAuth) {
    return
  }

  await handleOrganizationList(outputKind)
}
