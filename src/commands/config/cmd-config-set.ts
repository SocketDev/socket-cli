import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleConfigSet } from './handle-config-set'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { supportedConfigKeys } from '../../utils/config'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { LocalConfig } from '../../utils/config'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'set',
  description: 'Update the value of a local CLI config item',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <key> <value>

    Options
      ${getFlagListOutput(config.flags, 6)}

    This is a crude way of updating the local configuration for this CLI tool.

    Note that updating a value here is nothing more than updating a key/value
    store entry. No validation is happening. The server may reject your config.

    Keys:

${Array.from(supportedConfigKeys.entries())
  .map(([key, desc]) => `     - ${key} -- ${desc}`)
  .join('\n')}

    Examples
      $ ${command} apiProxy https://example.com
  `
}

export const cmdConfigSet = {
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
  const [key = '', ...rest] = cli.input
  const value = rest.join(' ')

  if (
    (!supportedConfigKeys.has(key as keyof LocalConfig) && key !== 'test') ||
    !value
  ) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(stripIndents`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:

      - Config key should be the first arg ${!key ? colors.red('(missing!)') : !supportedConfigKeys.has(key as any) ? colors.red('(invalid config key!)') : colors.green('(ok)')}

      - Key value should be the remaining args (use \`del\` to unset a value) ${!value ? colors.red('(missing!)') : colors.green('(ok)')}`)
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleConfigSet({
    key: key as keyof LocalConfig,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    value
  })
}
