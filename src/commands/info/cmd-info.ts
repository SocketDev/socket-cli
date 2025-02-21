import { getPackageInfo } from './get-package-info.ts'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { InputError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

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

  if (cli.input.length > 1) {
    throw new InputError('Only one package lookup supported at once')
  }
  const { 0: rawPkgName = '' } = cli.input
  let showHelp = cli.flags['help']
  if (!rawPkgName) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const versionSeparator = rawPkgName.lastIndexOf('@')
  const pkgName =
    versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion =
    versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)

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
