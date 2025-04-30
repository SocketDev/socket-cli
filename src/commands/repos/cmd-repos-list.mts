import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListRepos } from './handle-list-repos.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { isTestingV1 } from '../../utils/config.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { checkCommandInput } from '../../utils/handle-bad-input.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { getDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List repositories in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    sort: {
      type: 'string',
      shortFlag: 's',
      default: 'created_at',
      description: 'Sorting option'
    },
    direction: {
      type: 'string',
      default: 'desc',
      description: 'Direction option'
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
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Number of results per page'
    },
    page: {
      type: 'number',
      shortFlag: 'p',
      default: 1,
      description: 'Page number'
    },
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} ${isTestingV1() ? '' : '<org slug>'}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:list

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} ${isTestingV1() ? '' : '<org slug>'}
  `
}

export const cmdReposList = {
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

  const { json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const { dryRun, interactive, org: orgFlag } = cli.flags

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    !!interactive,
    !!dryRun
  )

  const apiToken = getDefaultToken()

  const wasBadInput = checkCommandInput(
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
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
    },
    {
      nook: true,
      test: !!apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleListRepos({
    direction: cli.flags['direction'] === 'asc' ? 'asc' : 'desc',
    orgSlug,
    outputKind,
    page: Number(cli.flags['page']) || 1,
    per_page: Number(cli.flags['perPage']) || 30,
    sort: String(cli.flags['sort'] || 'created_at')
  })
}
