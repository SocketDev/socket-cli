import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getPackageInfo } from './get-package-info'
import constants from '../../constants'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'info',
  description: 'Look up info regarding a package',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <name>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} webtorrent
      $ ${command} webtorrent@1.9.1
  `
}

export const cmdInfo = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | Readonly<string[]>,
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const [rawPkgName = ''] = cli.input

  if (!rawPkgName || cli.input.length > 1) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Expecting a package name ${!rawPkgName ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Can only accept one package at a time ${cli.input.length > 1 ? colors.red('(got ' + cli.input.length + '!)') : colors.green('(ok)')}\n`)
    return
  }

  const versionSeparator = rawPkgName.lastIndexOf('@')
  const pkgName =
    versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion =
    versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await getPackageInfo({
    commandName: `${parentName} ${config.commandName}`,
    includeAllIssues: Boolean(cli.flags['all']),
    outputJson: Boolean(cli.flags['json']),
    outputMarkdown: Boolean(cli.flags['markdown']),
    pkgName,
    pkgVersion,
    strict: Boolean(cli.flags['strict'])
  })
}
