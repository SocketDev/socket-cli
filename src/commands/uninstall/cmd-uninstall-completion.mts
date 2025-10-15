import { logger } from '@socketsecurity/registry/lib/logger'

import { handleUninstallCompletion } from './handle-uninstall-completion.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const config: CliCommandConfig = {
  commandName: 'completion',
  description: 'Uninstall bash completion for Socket CLI',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [COMMAND_NAME=socket]

    Uninstalls bash tab completion for the Socket CLI. This will:
    1. Remove tab completion from your current shell for given command
    2. Remove the setup for given command from your ~/.bashrc

    The optional name is required if you installed tab completion for an alias
    other than the default "socket". This will NOT remove the command, only the
    tab completion that is registered for it in bash.

    Options
      ${getFlagListOutput(config.flags)}

    Examples

      $ ${command}
      $ ${command} sd
  `,
}

export const cmdUninstallCompletion = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })
  const dryRun = !!cli.flags.dryRun

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const targetName = cli.input[0] || 'socket'

  await handleUninstallCompletion(String(targetName))
}
