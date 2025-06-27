import { logger } from '@socketsecurity/registry/lib/logger'

import { runRawNpm } from './run-raw-npm.mts'
import constants from '../../constants.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW, NPM } = constants

const config: CliCommandConfig = {
  commandName: 'raw-npm',
  description: `Temporarily disable the Socket ${NPM} wrapper`,
  hidden: false,
  flags: {},
  help: command => `
    Usage
      $ ${command} ...

    This does the opposite of \`socket npm\`: it will execute the real \`npm\`
    command without Socket. This can be useful when you have the wrapper on
    and want to install a certain package anyways. Use at your own risk.

    Note: Everything after "raw-npm" is sent straight to the npm command.
          Only the \`--dryRun\` and \`--help\` flags are caught here.

    Examples
      $ ${command} install -g socket
  `,
}

export const cmdRawNpm = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await runRawNpm(argv)
}
