import { handleAsk } from './handle-ask.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { InputError } from '../../util/error/errors.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

export const CMD_NAME = 'ask'

const description = 'Ask in plain English'

const hidden = false

export const cmdAsk = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
      execute: {
        type: 'boolean',
        shortFlag: 'e',
        default: false,
        description: 'Execute the command directly',
      },
      explain: {
        type: 'boolean',
        default: false,
        description: 'Show detailed explanation',
      },
    }),
    help: (command: string, config: { flags: MeowFlags }) => `
    Usage
      $ ${command} "<question>" [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} "scan for vulnerabilities"
      $ ${command} "is express safe to use"
      $ ${command} "fix critical issues" --execute
      $ ${command} "show production vulnerabilities" --explain
      $ ${command} "optimize my dependencies"

    Tips
      - Be specific about what you want
      - Mention "production" or "dev" to filter
      - Use severity levels: critical, high, medium, low
      - Say "dry run" to preview changes
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const query = cli.input[0]

  if (!query) {
    throw new InputError(
      'socket ask requires a QUERY positional argument; pass a question like `socket ask "scan for vulnerabilities"`',
    )
  }

  const execute = !!cli.flags['execute']
  const explain = !!cli.flags['explain']

  await handleAsk({
    query,
    execute,
    explain,
  })
}
