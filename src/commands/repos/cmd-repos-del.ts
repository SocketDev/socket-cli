import { logger } from '@socketsecurity/registry/lib/logger'

import { handleDeleteRepo } from './handle-delete-repo'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

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
      message: 'Repository name argument',
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

  await handleDeleteRepo(orgSlug, repoName)
}
