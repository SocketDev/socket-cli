import { logger } from '@socketsecurity/registry/lib/logger'

import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'view',
  description: '[Deprecated] View a project report',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: () => `
    This command is deprecated in favor of \`socket scan view\`.
    It will be removed in the next major release of the CLI.
  `
}

export const cmdReportView = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  logger.fail(
    'This command has been sunset. Instead, please look at `socket scan create` to create scans and `socket scan report` to view a report of your scans.'
  )

  process.exitCode = 1
}
