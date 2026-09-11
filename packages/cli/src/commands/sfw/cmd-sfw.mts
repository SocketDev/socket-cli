import os from 'node:os'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mts'
import { runFirewallCommand } from '../../util/firewall/run.mts'
import { runFirewallCaCommand } from '../../util/firewall/ca-command.mts'
import { splitFirewallArguments } from '../../util/cli/firewall-arguments.mts'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { isHelpFlag } from '../../util/process/cmd.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mts'

const logger = getDefaultLogger()

// Flags interface for type safety.
export interface SfwFlags {
  dryRun: boolean
}

const config = {
  commandName: 'sfw',
  description: 'Run Socket Firewall directly (alias: firewall)',
  flags: defineFlags({
    ...commonFlags,
  }),
  help: (command: string) => `
    Usage
      $ ${command} <package-manager> [args...]
      $ ${command} ca <init|path|trust> [args...]

    Options
      ${getFlagListOutput(commonFlags)}

    Socket Firewall intercepts package manager commands to scan packages
    before installation. This command allows direct access to sfw.

    Supported Package Managers:
      npm, pnpm, yarn, pip, uv, cargo, go, gem, bundler, nuget

    Note: For most use cases, prefer the dedicated commands:
      socket npm install <package>
      socket pnpm install <package>
      socket pip install <package>
      etc.

    Examples
      $ ${command} npm install lodash
      $ ${command} pnpm install lodash
      $ ${command} pip install requests
      $ ${command} --help
  `,
  hidden: false,
}

export const cmdSfw = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = {
    __proto__: null,
    ...context,
  } as CliCommandContext

  const { wrapperArgs, commandArgs } = splitFirewallArguments(argv, {
    explicitCommand: true,
  })

  // Check for help flag.
  const hasHelpFlag = wrapperArgs.some(a => isHelpFlag(a))

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
    argv: wrapperArgs.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName,
  })

  // Extract typed flags (commonFlags defines dryRun as boolean).
  const { dryRun } = cli.flags

  const sfwArgs = commandArgs

  if (!sfwArgs.length) {
    logger.fail('No package manager command specified.')
    logger.info('Usage: socket sfw <package-manager> [args...]')
    logger.info('Example: socket sfw npm install lodash')
    process.exitCode = 2
    return
  }

  if (dryRun) {
    outputDryRunExecute('sfw', sfwArgs, 'Socket Firewall (sfw)')
    return
  }

  if (sfwArgs[0] === 'ca') {
    await runFirewallCaCommand(sfwArgs.slice(1))
    return
  }

  const result = await runFirewallCommand(sfwArgs, {
    stdio: 'inherit',
  })

  if (result.signal) {
    process.exitCode = 128 + (os.constants.signals[result.signal] ?? 0)
    process.kill(process.pid, result.signal)
  } else if (typeof result.code === 'number') {
    process.exitCode = result.code
  }
}
