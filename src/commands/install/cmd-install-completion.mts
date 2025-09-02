import { logger } from '@socketsecurity/registry/lib/logger'

import { handleInstallCompletion } from './handle-install-completion.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'completion',
  description: 'Install bash completion for Socket CLI',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [NAME=socket]

    Installs bash completion for the Socket CLI. This will:
    1. Source the completion script in your current shell
    2. Add the source command to your ~/.bashrc if it's not already there

    This command will only setup tab completion, nothing else.

    Afterwards you should be able to type \`socket \` and then press tab to
    have bash auto-complete/suggest the sub/command or flags.

    Currently only supports bash.

    The optional name argument allows you to enable tab completion on a command
    name other than "socket". Mostly for debugging but also useful if you use a
    different alias for socket on your system.

    Options
      ${getFlagListOutput(config.flags)}

    Examples

      $ ${command}
      $ ${command} sd
      $ ${command} ./sd
  `,
}

export const cmdInstallCompletion = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const targetName = cli.input[0] || 'socket'

  await handleInstallCompletion(String(targetName))
}
