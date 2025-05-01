import { logger } from '@socketsecurity/registry/lib/logger'

import { wrapNpx } from './wrap-npx.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW, NPX } = constants

const config: CliCommandConfig = {
  commandName: 'npx',
  description: `${NPX} wrapper functionality`,
  hidden: false,
  flags: {
    ...commonFlags
  },
  help: (command, _config) => `
    Usage
      $ ${command}
  `
}

export const cmdNpx = {
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
    allowUnknownFlags: true,
    argv,
    config,
    importMeta,
    parentName
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await wrapNpx(argv)
}
