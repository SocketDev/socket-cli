import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCI } from './handle-ci.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'ci',
  description:
    'Create a new scan and report whether it passes your security policy',
  hidden: true,
  flags: {
    ...commonFlags
  },
  help: (parentName, _config) => `
    Usage
      $ ${parentName}

    This command is intended to use in CI runs to allow automated systems to
    accept or reject a current build. When the scan does not pass your security
    policy, the exit code will be non-zero.

    It will use the default org for the set API token.
  `
}

export const cmdCI = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleCI()
}
