import { logger } from '@socketsecurity/registry/lib/logger'

import { handleViewRepo } from './handle-view-repo'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'view',
  description: 'View repositories in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    repoName: {
      description: 'The repository to check',
      default: '',
      type: 'string'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
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

  const { json, markdown, repoName } = cli.flags

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''

  const wasBadInput = handleBadInput(
    {
      hide: defaultOrgSlug,
      test: orgSlug,
      message: 'Org name as the first argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      test: repoName,
      message: 'Repository name using --repoName',
      pass: 'ok',
      fail: typeof repoName !== 'string' ? 'missing' : 'invalid'
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
