import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const require = createRequire(import.meta.url)

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'npm',
  description: `npm wrapper functionality`,
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: (command, _config) => `
    Usage
      $ ${command} ...

    This runs npm but checks packages through Socket before installing anything.
    See docs for more details.

    Note: Everything after "npm" is sent straight to the npm command.
          Only the \`--dryRun\` and \`--help\` flags are caught here.

    Use \`socket wrapper on\` to automatically enable this such that you don't
    have to write \`socket npm\` for that purpose.

    Examples
      $ ${command}
      $ ${command} install -g socket
  `,
}

export const cmdNpm = {
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
    allowUnknownFlags: true,
    argv,
    config,
    importMeta,
    parentName,
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  // Lazily access constants.shadowNpmBinPath.
  const shadowBin = require(constants.shadowNpmBinPath)
  await shadowBin('npm', argv)
}
