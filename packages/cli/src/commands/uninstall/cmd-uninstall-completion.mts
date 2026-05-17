import { handleUninstallCompletion } from './handle-uninstall-completion.mts'
import { outputDryRunDelete } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../util/output/formatting.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const config = {
  commandName: 'completion',
  description: 'Uninstall bash completion for Socket CLI',
  hidden: false,
  flags: defineFlags({
    ...commonFlags,
  }),
  help: (command: string, config: { flags: MeowFlags }) => `
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
  const dryRun = !!cli.flags['dryRun']
  const targetName = cli.input[0] || 'socket'

  if (dryRun) {
    outputDryRunDelete(
      'bash completion',
      `completion for "${targetName}" from ~/.bashrc`,
    )
    return
  }

  await handleUninstallCompletion(String(targetName))
}
