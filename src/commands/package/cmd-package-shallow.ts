import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { parsePackageSpecifiers } from './parse-package-specifiers'
import { showPurlInfo } from './show-purl-info'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'shallow',
  description:
    'Look up info regarding one or more packages but not their transitives',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <<ecosystem> <name> [<name> ...] | <purl> [<purl> ...]>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Requirements
      - quota: 100
      - scope: \`packages:list\`

    Show scoring details for one or more packages purely based on their own package.
    This means that any dependency scores are not reflected by the score. You can
    use the \`socket package score <pkg>\` command to get its full transitive score.

    Only a few ecosystems are supported like npm, golang, and maven.

    A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
    This command will automatically prepend "pkg:" when not present.

    If the first arg is an ecosystem, remaining args that are not a purl are
    assumed to be scoped to that ecosystem.

    Examples
      $ ${command} npm webtorrent
      $ ${command} npm webtorrent@1.9.1
      $ ${command} npm/webtorrent@1.9.1
      $ ${command} pkg:npm/webtorrent@1.9.1
      $ ${command} maven webtorrent babel
      $ ${command} npm/webtorrent golang/babel
      $ ${command} npm npm/webtorrent@1.0.1 babel
  `
}

export const cmdPackageShallow = {
  description: config.description,
  hidden: config.hidden,
  alias: {
    shallowScore: {
      description: config.description,
      hidden: true,
      argv: []
    }
  },
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
  const [ecosystem = '', ...pkgs] = cli.input

  const { purls, valid } = parsePackageSpecifiers(ecosystem, pkgs)

  if (!valid || !purls.length) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - First parameter should be an ecosystem or all args must be purls ${!valid ? colors.red('(bad!)') : colors.green('(ok)')}\n
      - Expecting at least one package ${!purls.length ? colors.red('(missing!)') : colors.green('(ok)')}\n
    `)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await showPurlInfo({
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    purls
  })
}
