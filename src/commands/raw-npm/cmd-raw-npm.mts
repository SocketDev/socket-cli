import { logger } from '@socketsecurity/lib/logger'
import {
  DRY_RUN_BAILING_NOW,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { runRawNpm } from './run-raw-npm.mts'

const config: CliCommandConfig = {
  commandName: 'raw-npm',
  description: 'Run npm without the Socket wrapper',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: command => `
    Usage
      $ ${command} ...

    Execute \`npm\` without gating installs through the Socket API.
    Useful when  \`socket wrapper on\` is enabled and you want to bypass
    the Socket wrapper. Use at your own risk.

    Note: Everything after "raw-npm" is passed to the npm command.
          Only the \`${FLAG_DRY_RUN}\` and \`${FLAG_HELP}\` flags are caught here.

    Examples
      $ ${command} install -g cowsay
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
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await runRawNpm(argv)
}
