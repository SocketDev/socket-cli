import { logger } from '@socketsecurity/registry/lib/logger'

import { handlePurlDeepScore } from './handle-purl-deep-score'
import { parsePackageSpecifiers } from './parse-package-specifiers'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'score',
  description:
    '[beta] Look up score for one package which reflects all of its transitive dependencies as well',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <<ecosystem> <name> | <purl>>

    API Token Requirements
      - Quota: 100 units
      - Permissions: packages:list

    Options
      ${getFlagListOutput(config.flags, 6)}

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
  const apiToken = getDefaultToken()

  const { purls, valid } = parsePackageSpecifiers(ecosystem, purl ? [purl] : [])

  const wasBadInput = handleBadInput(
    {
      test: valid,
      message: 'First parameter must be an ecosystem or the whole purl',
      pass: 'ok',
      fail: 'bad'
    },
    {
      test: purls.length === 1,
      message: 'Expecting at least one package',
      pass: 'ok',
      fail: purls.length === 0 ? 'missing' : 'too many'
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    },
    {
      nook: true,
      test: !!apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    }
  )
  if (wasBadInput) {
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
