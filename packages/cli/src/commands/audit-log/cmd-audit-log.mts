import { handleAuditLog } from './handle-audit-log.mts'
import { FLAG_JSON, FLAG_MARKDOWN } from '../../constants/cli.mts'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { InputError } from '../../util/error/errors.mts'
import { V1_MIGRATION_GUIDE_URL } from '../../constants/socket.mjs'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { determineOrgSlug } from '../../util/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { webLink } from '../../util/terminal/link.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

// Flags interface for type safety.
export interface AuditLogFlags {
  interactive: boolean
  json: boolean
  markdown: boolean
  org: string
  // The meow layer leaves garbage numeric input (`--page=invalid`) as the
  // raw string; Number() coercion below turns it into NaN for validation.
  page: number | string
  perPage: number | string
}

export const CMD_NAME = 'audit-log'

const description = 'Look up the audit log for an organization'

const hidden = false

export const cmdAuditLog = {
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
          'Allow for interactive elements, asking for input.\nUse --no-interactive to prevent any input questions, defaulting them to cancel/no.',
      },
      org: {
        type: 'string',
        description:
          'Force override the organization slug, overrides the default org from config',
      },
      page: {
        type: 'number',
        description: 'Result page to fetch',
      },
      perPage: {
        type: 'number',
        default: 30,
        description: 'Results per page - default is 30',
      },
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [FILTER]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    This feature requires an Enterprise Plan. To learn more about getting access
    to this feature and many more, please visit the ${webLink(`https://socket.dev/pricing`, 'Socket pricing page')}.

    The type FILTER arg is an enum. Defaults to any. It should be one of these:
      associateLabel, cancelInvitation, changeMemberRole, changePlanSubscriptionSeats,
      createApiToken, createLabel, deleteLabel, deleteLabelSetting, deleteReport,
      deleteRepository, disassociateLabel, joinOrganization, removeMember,
      resetInvitationLink, resetOrganizationSettingToDefault, rotateApiToken,
      sendInvitation, setLabelSettingToDefault, syncOrganization, transferOwnership,
      updateAlertTriage, updateApiTokenCommitter, updateApiTokenMaxQuota,
      updateApiTokenName', updateApiTokenScopes, updateApiTokenVisibility,
      updateLabelSetting, updateOrganizationSetting, upgradeOrganizationPlan

    The page arg should be a positive integer, offset 1. Defaults to 1.

    Options
      ${getFlagListOutput(helpConfig.flags)}

    Examples
      $ ${command}
      $ ${command} deleteReport --page 2 --per-page 10
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const { interactive, json, markdown, org: orgFlag, page, perPage } = cli.flags

  const dryRun = cli.flags['dryRun']

  const noLegacy = !cli.flags['type']

  const [typeFilter = ''] = cli.input

  const hasApiToken = hasDefaultApiToken()

  const { 0: orgSlug } = await determineOrgSlug(
    orgFlag || '',
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: noLegacy,
      message: `Legacy flags are no longer supported. See the ${webLink(V1_MIGRATION_GUIDE_URL, 'v1 migration guide')}.`,
      fail: 'received legacy flags',
    },
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
      fail: 'bad',
    },
    {
      nook: true,
      test: /^[a-zA-Z]*$/.test(typeFilter),
      message: 'The filter must be an a-zA-Z string, it is an enum',
      fail: 'it was given but not a-zA-Z',
    },
  )
  if (!wasValidInput) {
    return
  }

  // Validate numeric pagination parameters.
  const validatedPage = Number(page || 0)
  const validatedPerPage = Number(perPage || 0)

  if (dryRun) {
    outputDryRunFetch('audit log entries', {
      organization: orgSlug,
      filter: typeFilter || 'any',
      page: validatedPage || 1,
      perPage: validatedPerPage || 30,
    })
    return
  }

  if (Number.isNaN(validatedPage) || validatedPage < 0) {
    throw new InputError(
      `--page must be a non-negative integer (saw: "${page}"); pass a number like --page=1`,
    )
  }
  if (Number.isNaN(validatedPerPage) || validatedPerPage < 0) {
    throw new InputError(
      `--per-page must be a non-negative integer (saw: "${perPage}"); pass a number like --per-page=30`,
    )
  }

  await handleAuditLog({
    orgSlug,
    outputKind,
    page: validatedPage,
    perPage: validatedPerPage,
    logType:
      typeFilter && typeFilter.length > 0
        ? typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)
        : '',
  })
}
