import { logger } from '@socketsecurity/registry/lib/logger'

import { handlePackageInfo } from './handle-package-info'
import constants from '../../constants'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'info',
  description: 'Look up info regarding a package',
  hidden: true, // Deprecated
  flags: {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <name>

    Note: this command will be deprecated in favor of \`socket package score\` soon

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

  const { all, json, markdown, strict } = cli.flags
  const [rawPkgName = ''] = cli.input

  const wasBadInput = handleBadInput(
    {
      test: !!rawPkgName,
      message: 'Expecting a package name',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: cli.input.length === 1,
      message: 'Can only accept one package at a time',
      pass: 'ok',
      fail: 'got ' + cli.input.length
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
    }
  )
  if (wasBadInput) {
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

  await handlePackageInfo({
    commandName: `${parentName} ${config.commandName}`,
    includeAllIssues: Boolean(all),
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    pkgName,
    pkgVersion,
    strict: Boolean(strict)
  })
}
