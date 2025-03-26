import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListRepos } from './handle-list-repos'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

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
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
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

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''

  const wasBadInput = handleBadInput({
    hide: defaultOrgSlug,
    test: orgSlug,
    message: 'Org name as the first argument',
    pass: 'ok',
    fail: 'missing'
  })
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
    outputKind: cli.flags['json']
      ? 'json'
      : cli.flags['markdown']
        ? 'markdown'
        : 'print',
    page: Number(cli.flags['page']) || 1,
    per_page: Number(cli.flags['perPage']) || 30,
    sort: String(cli.flags['sort'] || 'created_at')
  })
}
