import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDeleteRepo } from './handle-delete-repo.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'del',
  description: 'Delete a repository in an organization',
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
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] <REPO>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:delete

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} test-repo
  `,
}

export const cmdRepositoryDel = {
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

  const { dryRun, interactive, json, markdown, org: orgFlag } = cli.flags
  const outputKind = getOutputKind(json, markdown)
  const [repoName = ''] = cli.input

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
    !!dryRun,
  )

  const hasApiToken = hasDefaultToken()

  const noLegacy = !cli.flags['repoName']

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
      test: !!repoName,
      message: 'Repository name as first argument',
      pass: 'ok',
      fail: 'missing',
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

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleDeleteRepo(orgSlug, repoName, outputKind)
}
