import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { showPurlInfo } from './show-purl-info'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'score',
  description: 'Look up info regarding a package',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <<ecosystem> <name> [<name> ...] | <purl> [<purl> ...]>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Show scoring details for one or more packages.
    Only a few ecosystems are supported like npm, golang, and maven.

    If the first arg is an ecosystem, remaining args that are not a "purl" are
    assumed to be scoped in that ecosystem. If the first arg is in "purl" form
    then all args must be in purl form ("package url": \`pkg:eco/name@version\`).

    This command takes 100 quota units.
    This command requires \`packages:list\` scope access on your API token.

    Examples
      $ ${command} npm webtorrent
      $ ${command} npm webtorrent@1.9.1
      $ ${command} npm/webtorrent@1.9.1
      $ ${command} maven webtorrent babel
      $ ${command} npm/webtorrent golang/babel
      $ ${command} npm npm/webtorrent@1.0.1 babel
  `
}

export const cmdPackageScore = {
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
  const [ecosystem, ...pkgs] = cli.input

  if (!ecosystem || !pkgs.length || !pkgs[0]) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Expecting an ecosystem ${!ecosystem ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Expecting at least one package ${!pkgs.length || !pkgs[0] ? colors.red('(missing!)') : colors.green('(ok)')}\n
    `)
    return
  }

  const purls = pkgs.map(pkg => {
    return 'pkg:' + ecosystem + '/' + pkg
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await showPurlInfo({
    // commandName: `${parentName} ${config.commandName}`,
    // includeAllIssues: Boolean(all),
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    purls
    // strict: Boolean(strict)
  })
}
