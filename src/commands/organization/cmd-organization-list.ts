import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleOrganizationList } from './handle-organization-list'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List organizations associated with the API key used',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdOrganizationList = {
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

  const json = Boolean(cli.flags['json'])
  const markdown = Boolean(cli.flags['markdown'])
  if (json && markdown) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(stripIndents`
${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

  - The json and markdown flags cannot be both set, pick one
    `)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleOrganizationList(json ? 'json' : markdown ? 'markdown' : 'text')
}
