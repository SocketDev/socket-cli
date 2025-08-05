import { logger } from '@socketsecurity/registry/lib/logger'

import { handleAuditLog } from './handle-audit-log.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW, SOCKET_WEBSITE_URL } = constants

const config: CliCommandConfig = {
  commandName: 'audit-log',
  description: 'Look up the audit log for an organization',
  hidden: false,
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
    page: {
      type: 'number',
      description: 'Result page to fetch',
    },
    perPage: {
      type: 'number',
      default: 30,
      description: 'Results per page - default is 30',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [FILTER]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: audit-log:list

    This feature requires an Enterprise Plan. To learn more about getting access
    to this feature and many more, please visit ${SOCKET_WEBSITE_URL}/pricing

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
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} deleteReport --page 2 --perPage 10
  `,
}

export const cmdAuditLog = {
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

  const {
    dryRun,
    interactive,
    json,
    markdown,
    org: orgFlag,
    page,
    perPage,
  } = cli.flags

  let [typeFilter = ''] = cli.input
  typeFilter = String(typeFilter)

  const hasApiToken = hasDefaultToken()

  const noLegacy = !cli.flags['type']

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
    !!dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: noLegacy,
      message: 'Legacy flags are no longer supported. See v1 migration guide.',
      pass: 'ok',
      fail: `received legacy flags`,
    },
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      pass: 'ok',
      fail: 'missing',
    },
    {
      nook: true,
      test: hasApiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing Socket API token',
    },
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
      test: /^[a-zA-Z]*$/.test(typeFilter),
      message: 'The filter must be an a-zA-Z string, it is an enum',
      pass: 'ok',
      fail: 'it was given but not a-zA-Z',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleAuditLog({
    orgSlug,
    outputKind,
    page: Number(page || 0),
    perPage: Number(perPage || 0),
    logType: typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1),
  })
}
