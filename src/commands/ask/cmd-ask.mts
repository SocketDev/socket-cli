import { logger } from '@socketsecurity/registry/lib/logger'

import { handleAsk } from './handle-ask.mts'
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

export const CMD_NAME = 'ask'

const description = 'Ask in plain English'

const hidden = false

export const cmdAsk = {
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
    hidden,
    flags: {
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
    },
    help: (command, config) => `
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
    logger.error('Please provide a question')
    logger.log('\nExample: socket ask "scan for vulnerabilities"')
    process.exit(1)
  }

  const execute = !!cli.flags.execute
  const explain = !!cli.flags.explain

  await handleAsk({
    query,
    execute,
    explain,
  })
}
