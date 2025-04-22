import { logger } from '@socketsecurity/registry/lib/logger'

import { handleViewRepo } from './handle-view-repo'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue, isTestingV1 } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'
import { suggestOrgSlug } from '../scan/suggest-org-slug'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

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
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.'
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config'
    },
    repoName: {
      description: 'The repository to check',
      default: '',
      type: 'string'
    }
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
  `
}

export const cmdReposView = {
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

  const defaultOrgSlug = getConfigValue('defaultOrg')

  const interactive = cli.flags['interactive']
  const dryRun = cli.flags['dryRun']

  let orgSlug = String(cli.flags['org'] || defaultOrgSlug || '')
  if (!orgSlug) {
    if (isTestingV1()) {
      // ask from server
      logger.error(
        'Missing the org slug and no --org flag set. Trying to auto-discover the org now...'
      )
      logger.error(
        'Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.'
      )
      if (dryRun) {
        logger.fail('Skipping auto-discovery of org in dry-run mode')
      } else if (!interactive) {
        logger.fail('Skipping auto-discovery of org when interactive = false')
      } else {
        orgSlug = (await suggestOrgSlug()) || ''
      }
    } else {
      orgSlug = cli.input[0] || ''
    }
  }

  const repoNameFlag = cli.flags['repoName']
  const repoName = (isTestingV1() ? cli.input[0] : repoNameFlag) || ''

  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
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
    },
    {
      nook: true,
      test: !isTestingV1() || !repoNameFlag,
      message: 'In v1 the first arg should be the repo, not the flag',
      pass: 'ok',
      fail: 'received --repo-name flag'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleViewRepo(
    orgSlug,
    String(repoName),
    json ? 'json' : markdown ? 'markdown' : 'text'
  )
}
