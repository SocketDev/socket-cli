import { logger } from '@socketsecurity/registry/lib/logger'

import { handleUpdateRepo } from './handle-update-repo.mts'
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
  commandName: 'update',
  description: 'Update a repository in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    defaultBranch: {
      type: 'string',
      shortFlag: 'b',
      default: 'main',
      description: 'Repository default branch',
    },
    homepage: {
      type: 'string',
      shortFlag: 'h',
      default: '',
      description: 'Repository url',
    },
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
    repoDescription: {
      type: 'string',
      shortFlag: 'd',
      default: '',
      description: 'Repository description',
    },
    visibility: {
      type: 'string',
      shortFlag: 'v',
      default: 'private',
      description: 'Repository visibility (Default Private)',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] <REPO>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:update

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} test-repo
      $ ${command} test-repo --homepage https://example.com
  `,
}

export const cmdRepositoryUpdate = {
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

  const { interactive, json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const noLegacy = !cli.flags['repoName']

  const [repoName = ''] = cli.input

  const hasApiToken = hasDefaultToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: noLegacy,
      message: 'Legacy flags are no longer supported. See v1 migration guide.',
      fail: `received legacy flags`,
    },
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
    },
    {
      test: !!repoName,
      message: 'Repository name as first argument',
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
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleUpdateRepo(
    {
      orgSlug,
      repoName: String(repoName),
      description: String(cli.flags['repoDescription'] || ''),
      homepage: String(cli.flags['homepage'] || ''),
      defaultBranch: String(cli.flags['defaultBranch'] || ''),
      visibility: String(cli.flags['visibility'] || 'private'),
    },
    outputKind,
  )
}
