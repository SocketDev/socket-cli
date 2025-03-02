import { logger } from '@socketsecurity/registry/lib/logger'

import { wrapNpm } from './wrap-npm'
import constants from '../../constants'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { NPM } = constants

const config: CliCommandConfig = {
  commandName: 'npm',
  description: `${NPM} wrapper functionality`,
  hidden: false,
  flags: {},
  help: (command, _config) => `
    Usage
      $ ${command}
  `
}

export const cmdNpm = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
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
    logger.log('[DryRun] Bailing now')
    return
  }

  await wrapNpm(argv)
}
