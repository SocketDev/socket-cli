import colors from 'yoctocolors-cjs'

import { getPackageInfo } from './get-package-info'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

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

  const [rawPkgName = ''] = cli.input

  if (!rawPkgName || cli.input.length > 1) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Expecting a package name ${!rawPkgName ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Can only accept one package at a time ${cli.input.length > 1 ? colors.red('(got ' + cli.input.length + '!)') : colors.green('(ok)')}\n
    `)
    process.exitCode = 2 // bad input
    return
  }

  const versionSeparator = rawPkgName.lastIndexOf('@')
  const pkgName =
    versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion =
    versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

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
