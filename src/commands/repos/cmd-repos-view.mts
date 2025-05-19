import { logger } from '@socketsecurity/registry/lib/logger'

import { handleViewRepo } from './handle-view-repo.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { isTestingV1 } from '../../utils/config.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'view',
  description: 'View repositories in an organization',
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
    repoName: {
      description: 'The repository to check',
      default: '',
      type: 'string',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} ${isTestingV1() ? '<repo>' : '<org slug> --repo-name=<name>'}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:list

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} ${isTestingV1() ? 'test-repo' : 'FakeOrg test-repo'}
  `,
}

export const cmdReposView = {
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
    repoName: repoNameFlag,
  } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    !!interactive,
    !!dryRun,
  )

  const repoName = (isTestingV1() ? cli.input[0] : repoNameFlag) || ''

  const hasApiToken = hasDefaultToken()

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: isTestingV1()
        ? 'Org name by default setting, --org, or auto-discovered'
        : 'Org name must be the first argument',
      pass: 'ok',
      fail: 'missing',
    },
    {
      test: !!repoName,
      message: isTestingV1()
        ? 'Repository name as first argument'
        : 'Repository name using --repoName',
      pass: 'ok',
      fail: 'missing',
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
      test: hasApiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token',
    },
    {
      nook: true,
      test: !isTestingV1() || !repoNameFlag,
      message: 'In v1 the first arg should be the repo, not the flag',
      pass: 'ok',
      fail: 'received --repo-name flag',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleViewRepo(orgSlug, String(repoName), outputKind)
}
