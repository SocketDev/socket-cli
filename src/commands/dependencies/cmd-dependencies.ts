import { findDependencies } from './find-dependencies.ts'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const config: CliCommandConfig = {
  commandName: 'dependencies',
  description:
    'Search for any dependency that is being used in your organization',
  hidden: false,
  flags: {
    ...commonFlags,
    limit: {
      type: 'number',
      shortFlag: 'l',
      default: 50,
      description: 'Maximum number of dependencies returned'
    },
    offset: {
      type: 'number',
      shortFlag: 'o',
      default: 0,
      description: 'Page number'
    },
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      ${command} --limit 20 --offset 10
  `
}

export const cmdScanCreate = {
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
    argv,
    config,
    importMeta,
    parentName
  })

  // TODO: markdown flag is ignored
  await findDependencies({
    limit: Number(cli.flags['limit'] || 0) || 0,
    offset: Number(cli.flags['offset'] || 0) || 0,
    outputJson: Boolean(cli.flags['json'])
  })
}
