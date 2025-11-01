import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { handleOrgScanMetadata } from './handle-scan-metadata.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { determineOrgSlug } from '../../utils/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
  CliSubcommand,
} from '../../utils/cli/with-subcommands.mjs'

export const CMD_NAME = 'metadata'

const description = "Get a scan's metadata"

const hidden = false

export const cmdScanMetadata: CliSubcommand = {
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
    help: (command, config) => `
    Usage
      $ ${command} [options] <SCAN_ID>

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} 000aaaa1-0000-0a0a-00a0-00a0000000a0
      $ ${command} 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const interactive = !!cli.flags['interactive']

  const [scanId = ''] = cli.input

  const hasApiToken = hasDefaultApiToken()

  const { 0: orgSlug } = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail:
        orgSlug === '.'
          ? 'dot is an invalid org, most likely you forgot the org name here?'
          : 'missing',
    },
    {
      test: !!scanId,
      message: 'Scan ID to inspect as argument',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    getDefaultLogger().log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleOrgScanMetadata(orgSlug, scanId, outputKind)
}
