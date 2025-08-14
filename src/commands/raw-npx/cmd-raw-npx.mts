import { logger } from '@socketsecurity/registry/lib/logger'

import { runRawNpx } from './run-raw-npx.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'raw-npx',
  description: 'Run npx without the Socket wrapper',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: command => `
    Usage
      $ ${command} ...

    This does the opposite of \`socket npx\`: it will execute the real \`npx\`
    command without Socket. This can be useful when you have the wrapper on
    and want to run a certain package anyways. Use at your own risk.

    Note: Everything after "raw-npx" is sent straight to the npx command.
          Only the \`--dryRun\` and \`--help\` flags are caught here.

    Examples
      $ ${command} prettier
  `,
}

export const cmdRawNpx = {
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

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await runRawNpx(argv)
}
