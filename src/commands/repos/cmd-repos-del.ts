import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDeleteRepo } from './handle-delete-repo'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'del',
  description: 'Delete a repository in an organization',
  hidden: false,
  flags: {
    ...commonFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug> <repo slug>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:delete

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg test-repo
  `
}

export const cmdReposDel = {
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

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''
  const repoName = (defaultOrgSlug ? cli.input[0] : cli.input[1]) || ''
  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name as the first argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      test: !!repoName,
      message: 'Repository name argument',
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
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleDeleteRepo(orgSlug, repoName)
}
