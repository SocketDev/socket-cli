import {
  CliCommandConfig,
  meowOrExit
} from '../../utils/meow-with-subcommands.ts'
import { getFlagListOutput } from '../../utils/output-formatting.ts'

const config: CliCommandConfig = {
  commandName: 'oops',
  description: 'Trigger an intentional error (for development)',
  hidden: true,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdOops = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  meowOrExit({
    config,
    argv,
    parentName,
    importMeta
  })

  throw new Error('This error was intentionally left blank')
}
