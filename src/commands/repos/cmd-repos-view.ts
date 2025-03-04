import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { viewRepo } from './view-repo'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
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

  const repoName = cli.flags['repoName']
  const [orgSlug = ''] = cli.input

  if (!repoName || typeof repoName !== 'string' || !orgSlug) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(
      stripIndents`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Org name as the first argument ${
        !orgSlug ? colors.red('(missing!)') : colors.green('(ok)')
      }

      - Repository name using --repoName ${
        !repoName
          ? colors.red('(missing!)')
          : typeof repoName !== 'string'
            ? colors.red('(invalid!)')
            : colors.green('(ok)')
      }
    `
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await viewRepo(
    orgSlug,
    repoName,
    cli.flags['json'] ? 'json' : cli.flags['markdown'] ? 'markdown' : 'print'
  )
}
