import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handlePurlDeepScore } from './handle-purl-deep-score'
import { parsePackageSpecifiers } from './parse-package-specifiers'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'score',
  description:
    'Look up score for one package which reflects all of its transitive dependencies as well',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <<ecosystem> <name> | <purl>>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Requirements
      - quota: 100
      - scope: \`packages:list\`

    Show deep scoring details for one package. The score will reflect the package
    itself, any of its dependencies, and any of its transitive dependencies.

    When you want to know whether to trust a package, this is the command to run.

    See also the \`socket package shallow\` command, which returns the shallow
    score for any number of packages. That will not reflect the dependency scores.

    Only a few ecosystems are supported like npm, golang, and maven.

    A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
    This command will automatically prepend "pkg:" when not present.

    The version is optional but when given should be a direct match.

    Examples
      $ ${command} npm babel-cli
      $ ${command} npm babel-cli@1.9.1
      $ ${command} npm/babel-cli@1.9.1
      $ ${command} pkg:npm/babel-cli@1.9.1
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
  const [ecosystem = '', purl] = cli.input

  const { purls, valid } = parsePackageSpecifiers(ecosystem, purl ? [purl] : [])

  if (!valid || !purls.length) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - First parameter should be an ecosystem or the arg must be a purl ${!valid ? colors.red('(bad!)') : colors.green('(ok)')}\n
      - Expecting the package to check ${!purls.length ? colors.red('(missing!)') : colors.green('(ok)')}\n
    `)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handlePurlDeepScore(
    purls[0] || '',
    json ? 'json' : markdown ? 'markdown' : 'text'
  )
}
