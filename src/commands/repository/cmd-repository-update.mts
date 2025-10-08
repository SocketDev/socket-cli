/** @fileoverview Repository update command for Socket CLI. Updates Socket repository integration settings for GitHub repositories. Modifies default branch, visibility, and scanning configuration. Supports JSON and text output. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleUpdateRepo } from './handle-update-repo.mts'
import constants, { V1_MIGRATION_GUIDE_URL } from '../../constants.mts'
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
import { webLink } from '../../utils/terminal-link.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'update'

const description = 'Update a repository in an organization'

const hidden = false

export const cmdRepositoryUpdate = {
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
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} test-repo
      $ ${command} test-repo --homepage https://example.com
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

  const noLegacy = !cli.flags['repoName']

  const [repoName = ''] = cli.input

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
      test: noLegacy,
      message: `Legacy flags are no longer supported. See the ${webLink(V1_MIGRATION_GUIDE_URL, 'v1 migration guide')}.`,
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
      // Skip API token check in dry-run mode
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

  await handleUpdateRepo(
    String(repoName),
    {
      description: String(cli.flags['repoDescription'] || ''),
      private: String(cli.flags['visibility'] || 'private') === 'private',
      outputKind,
    },
  )
}
