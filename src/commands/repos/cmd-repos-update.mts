import { logger } from '@socketsecurity/registry/lib/logger'

import { handleUpdateRepo } from './handle-update-repo.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { isTestingV1 } from '../../utils/config.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'update',
  description: 'Update a repository in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    defaultBranch: {
      type: 'string',
      shortFlag: 'b',
      default: 'main',
      description: 'Repository default branch'
    },
    homepage: {
      type: 'string',
      shortFlag: 'h',
      default: '',
      description: 'Repository url'
    },
    interactive: {
      type: 'boolean',
      default: true,
      description:
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.'
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config'
    },
    repoName: {
      type: 'string',
      shortFlag: 'n',
      default: '',
      description: 'Repository name'
    },
    repoDescription: {
      type: 'string',
      shortFlag: 'd',
      default: '',
      description: 'Repository description'
    },
    visibility: {
      type: 'string',
      shortFlag: 'v',
      default: 'private',
      description: 'Repository visibility (Default Private)'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} ${isTestingV1() ? '<repo>' : '<org slug> --repo-name=<name>'}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:update

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} ${isTestingV1() ? 'test-repo' : 'FakeOrg test-repo'}
  `
}

export const cmdReposUpdate = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const { dryRun, interactive, json, markdown, org: orgFlag } = cli.flags
  const outputKind = getOutputKind(json, markdown) // TODO: impl json/md further

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    !!interactive,
    !!dryRun
  )

  const repoNameFlag = cli.flags['repoName']
  const repoName = (isTestingV1() ? cli.input[0] : repoNameFlag) || ''

  const apiToken = getDefaultToken()

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: isTestingV1()
        ? 'Org name by default setting, --org, or auto-discovered'
        : 'Org name must be the first argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      test: !!repoName,
      message: isTestingV1()
        ? 'Repository name as first argument'
        : 'Repository name using --repoName',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: !!apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    },
    {
      nook: true,
      test: !isTestingV1() || !repoNameFlag,
      message: 'In v1 the first arg should be the repo, not the flag',
      pass: 'ok',
      fail: 'received --repo-name flag'
    }
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleUpdateRepo(
    {
      orgSlug,
      repoName: String(repoName),
      description: String(cli.flags['repoDescription'] || ''),
      homepage: String(cli.flags['homepage'] || ''),
      default_branch: String(cli.flags['defaultBranch'] || ''),
      visibility: String(cli.flags['visibility'] || 'private')
    },
    outputKind
  )
}
