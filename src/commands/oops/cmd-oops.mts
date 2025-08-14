import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'oops',
  description: 'Trigger an intentional error (for development)',
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags,
    throw: {
      type: 'boolean',
      default: false,
      description:
        'Throw an explicit error even if --json or --markdown are set',
    },
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Don't run me.
  `,
}

export const cmdOops = {
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
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown, throw: justThrow } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  if (json && !justThrow) {
    process.exitCode = 1
    logger.log(
      serializeResultJson({
        ok: false,
        message: 'Oops',
        cause: 'This error was intentionally left blank',
      }),
    )
  }

  if (markdown && !justThrow) {
    process.exitCode = 1
    logger.fail(
      failMsgWithBadge('Oops', 'This error was intentionally left blank'),
    )
    return
  }

  throw new Error('This error was intentionally left blank')
}
