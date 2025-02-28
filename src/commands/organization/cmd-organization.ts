import colors from 'yoctocolors-cjs'

import { getOrganization } from './get-organization.ts'
import { commonFlags, outputFlags } from '../../flags.ts'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'organizations',
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

export const cmdOrganization = {
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

  const json = Boolean(cli.flags['json'])
  const markdown = Boolean(cli.flags['markdown'])
  if (json && markdown) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    console.error(`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - The json and markdown flags cannot be both set, pick one
    `)
    return
  }

  if (cli.flags['dryRun']) {
    return console.log('[DryRun] Bailing now')
  }

  await getOrganization(json ? 'json' : markdown ? 'markdown' : 'text')
}
