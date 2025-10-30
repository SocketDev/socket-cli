
import { handleConsole } from './handle-console.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

export const CMD_NAME = 'console'

const description = 'Interactive console with AI-powered natural language'

const hidden = false

export const cmdConsole = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    flags: {
      ...commonFlags,
      banner: {
        type: 'boolean',
        default: false,
        description: 'Hide the banner at startup.',
        hidden: true,
      },
    },
    help: (command, config) => `
    Usage
      $ ${command}

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}

    Tips
      - Ask questions in natural language
      - Use Tab to switch between console and input
      - Press Shift+Enter for multi-line input
      - Press Ctrl-C again to exit
  `,
    hidden,
  }

  meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  await handleConsole()
}
