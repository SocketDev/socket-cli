/**
 * Socket Firewall (sfw) command.
 *
 * Explicit passthrough to the Socket Firewall tool for direct invocation.
 * Socket Firewall intercepts package manager commands to provide security
 * scanning before installation.
 *
 * While `socket npm`, `socket npx`, etc. use sfw internally, this command
 * allows direct access to sfw for advanced use cases and troubleshooting.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mts'
import { spawnSfw } from '../../utils/dlx/spawn.mts'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { filterFlags, isHelpFlag } from '../../utils/process/cmd.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mts'

const logger = getDefaultLogger()

const config: CliCommandConfig = {
  commandName: 'sfw',
  description: 'Run Socket Firewall directly (alias: firewall)',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: command => `
    Usage
      $ ${command} <package-manager> [args...]

    Options
      ${getFlagListOutput(commonFlags)}

    Socket Firewall intercepts package manager commands to scan packages
    before installation. This command allows direct access to sfw.

    Supported Package Managers:
      npm, npx, pnpm, yarn, pip, pip3, uv, cargo, go, gem, bundler, nuget

    Note: For most use cases, prefer the dedicated commands:
      socket npm install <package>
      socket npx <package>
      socket pip install <package>
      etc.

    Examples
      $ ${command} npm install lodash
      $ ${command} npx cowsay hello
      $ ${command} pip install requests
      $ ${command} --help
  `,
}

export const cmdSfw = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = {
    __proto__: null,
    ...context,
  } as CliCommandContext

  // Check for help flag.
  const hasHelpFlag = argv.some(a => isHelpFlag(a))

  if (hasHelpFlag) {
    // Show Socket CLI wrapper help.
    meowOrExit({
      argv: ['--help'],
      config,
      importMeta,
      parentName,
    })
    // meowOrExit will exit here.
    return
  }

  const cli = meowOrExit({
    argv: argv.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName,
  })

  const { dryRun } = cli.flags as unknown as { dryRun: boolean }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  // Filter Socket-specific flags from argv, pass rest to sfw.
  const sfwArgs = filterFlags(argv, commonFlags, [])

  if (!sfwArgs.length) {
    logger.fail('No package manager command specified.')
    logger.info('Usage: socket sfw <package-manager> [args...]')
    logger.info('Example: socket sfw npm install lodash')
    process.exitCode = 2
    return
  }

  logger.info(`Invoking Socket Firewall: sfw ${sfwArgs.join(' ')}`)

  const { spawnPromise } = await spawnSfw(sfwArgs, {
    stdio: 'inherit',
  })

  const result = await spawnPromise

  if (result.signal) {
    process.kill(process.pid, result.signal)
  } else if (typeof result.code === 'number') {
    process.exitCode = result.code
  }
}
