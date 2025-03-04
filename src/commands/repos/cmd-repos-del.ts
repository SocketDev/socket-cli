import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { deleteRepo } from './delete-repo'
import constants from '../../constants'
import { commonFlags } from '../../flags'
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

  const [orgSlug = '', repoName = ''] = cli.input

  if (!orgSlug || !repoName) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(stripIndents`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}

      - Repository name as the second argument ${!repoName ? colors.red('(missing!)') : typeof repoName !== 'string' ? colors.red('(invalid!)') : colors.green('(ok)')}

      - At least one TARGET (e.g. \`.\` or \`./package.json\``)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await deleteRepo(orgSlug, repoName)
}
