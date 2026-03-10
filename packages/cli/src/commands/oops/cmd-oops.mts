import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_LABEL } from '../../constants/cli.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

export const CMD_NAME = 'oops'

const description = 'Trigger an intentional error (for development)'

const hidden = true

// Command handler.

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

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown, throw: justThrow } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log('')
    logger.log(`${DRY_RUN_LABEL}: Would trigger an intentional error`)
    logger.log('')
    logger.log(
      '  This command throws an error for development/testing purposes.',
    )
    logger.log(`  Error message: "This error was intentionally left blank."`)
    logger.log('')
    if (json && !justThrow) {
      logger.log('  Output format: JSON error response')
    } else if (markdown && !justThrow) {
      logger.log('  Output format: Markdown error message')
    } else {
      logger.log('  Output format: Thrown Error exception')
    }
    logger.log('')
    logger.log('  Run without --dry-run to trigger the error.')
    logger.log('')
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

  throw new Error('This error was intentionally left blank.')
}

// Exported command.

export const cmdOops = {
  description,
  hidden,
  run,
}
