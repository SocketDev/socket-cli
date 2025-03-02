import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { updateRepo } from './update-repo'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'update',
  description: 'Update a repository in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
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
    homepage: {
      type: 'string',
      shortFlag: 'h',
      default: '',
      description: 'Repository url'
    },
    defaultBranch: {
      type: 'string',
      shortFlag: 'b',
      default: 'main',
      description: 'Repository default branch'
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
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
  `
}

export const cmdReposUpdate = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
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
    logger.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Repository name using --repoName ${!repoName ? colors.red('(missing!)') : typeof repoName !== 'string' ? colors.red('(invalid!)') : colors.green('(ok)')}\n
      - At least one TARGET (e.g. \`.\` or \`./package.json\`\n`)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await updateRepo({
    apiToken,
    outputJson: Boolean(cli.flags['json']),
    outputMarkdown: Boolean(cli.flags['markdown']),
    orgSlug,
    repoName,
    description: String(cli.flags['repoDescription'] || ''),
    homepage: String(cli.flags['homepage'] || ''),
    default_branch: String(cli.flags['defaultBranch'] || ''),
    visibility: String(cli.flags['visibility'] || 'private')
  })
}
