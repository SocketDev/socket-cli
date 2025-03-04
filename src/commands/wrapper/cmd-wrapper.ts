import { existsSync } from 'node:fs'

import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { addSocketWrapper } from './add-socket-wrapper'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup'
import { postinstallWrapper } from './postinstall-wrapper'
import { removeSocketWrapper } from './remove-socket-wrapper'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'wrapper',
  description: 'Enable or disable the Socket npm/npx wrapper',
  hidden: false,
  flags: {
    ...commonFlags,
    enable: {
      type: 'boolean',
      default: false,
      description: 'Enables the Socket npm/npx wrapper'
    },
    disable: {
      type: 'boolean',
      default: false,
      description: 'Disables the Socket npm/npx wrapper'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} <flag>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} --enable
      $ ${command} --disable
  `
}

export const cmdWrapper = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  // I don't think meow would mess with this but ...
  if (argv[0] === '--postinstall') {
    postinstallWrapper()
    return
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const { enable } = cli.flags
  if (!enable && !cli.flags['disable']) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      stripIndents`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required flags:

      - Must use --enabled or --disabled
    `
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  // Lazily access constants.bashRcPath and constants.zshRcPath.
  const { bashRcPath, zshRcPath } = constants
  if (enable) {
    if (existsSync(bashRcPath) && !checkSocketWrapperSetup(bashRcPath)) {
      addSocketWrapper(bashRcPath)
    }
    if (existsSync(zshRcPath) && !checkSocketWrapperSetup(zshRcPath)) {
      addSocketWrapper(zshRcPath)
    }
  } else {
    if (existsSync(bashRcPath)) {
      removeSocketWrapper(bashRcPath)
    }
    if (existsSync(zshRcPath)) {
      removeSocketWrapper(zshRcPath)
    }
  }
  if (!existsSync(bashRcPath) && !existsSync(zshRcPath)) {
    logger.fail('There was an issue setting up the alias in your bash profile')
  }
}
