import { logger } from '@socketsecurity/registry/lib/logger'

import { runRawNpx } from './run-raw-npx.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

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

    Execute \`npx\` without gating installs through the Socket API.
    Useful when  \`socket wrapper on\` is enabled and you want to bypass
    the Socket wrapper. Use at your own risk.

    Note: Everything after "raw-npx" is passed to the npx command.
          Only the \`--dry-run\` and \`--help\` flags are caught here.

    Examples
      $ ${command} cowsay
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
  { parentName }: CliCommandContext,
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

  await runRawNpx(argv)
}
