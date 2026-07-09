import { handleDeleteScan } from './handle-delete-scan.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { outputDryRunDelete } from '../../util/dry-run/output.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { determineOrgSlug } from '../../util/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

export const CMD_NAME = 'del'

const description = 'Delete a scan'

const hidden = false

export const cmdScanDel = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
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
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] <SCAN_ID>

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(helpConfig.flags)}

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

  const [orgSlug, defaultOrgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: !!defaultOrgSlug,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
    },
    {
      test: !!scanId,
      message: 'Scan ID to delete',
      fail: 'missing',
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
    outputDryRunDelete('scan', `${orgSlug}/${scanId}`)
    return
  }

  await handleDeleteScan(orgSlug, scanId, outputKind)
}
