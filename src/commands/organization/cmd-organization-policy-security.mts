/** @fileoverview Organization security policy command for Socket CLI. Displays security policy settings including alert thresholds, issue actions, and scanning preferences for organization-wide security compliance. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleSecurityPolicy } from './handle-security-policy.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
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

export const CMD_NAME = 'security'

const description = 'Retrieve the security policy of an organization'

const hidden = true

export const cmdOrganizationPolicySecurity = {
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
      interactive: {
        type: 'boolean',
        default: true,
        description:
          'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
      },
      org: {
        type: 'string',
        description:
          'Force override the organization slug, overrides the default org from config',
      },
    },
    help: (command, _config) => `
    Usage
      $ ${command} [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Your API token will need the \`security-policy:read\` permission otherwise
    the request will fail with an authentication error.

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

  const { json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const interactive = !!cli.flags['interactive']

  const outputKind = getOutputKind(json, markdown)

  const { 0: orgSlug } = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  // Input validations (run even in dry-run mode)
  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Unable to determine organization slug',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
  )
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
    test: dryRun || hasApiToken,  // Skip API token check in dry-run mode
    message: 'This command requires a Socket API token for access',
    fail: 'try `socket login`',
  })
  if (!wasValidAuth) {
    return
  }

  await handleSecurityPolicy(orgSlug, outputKind)
}
