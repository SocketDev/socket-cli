import { stripIndent } from 'common-tags'

import { joinOr } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { runFix } from './run-fix'
import { RangeStyles } from './types'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { RangeStyle } from './types'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Fix "fixable" Socket alerts',
  hidden: true,
  flags: {
    ...commonFlags,
    rangeStyle: {
      type: 'string',
      default: 'preserve',
      description: stripIndent`
      Define how updated dependency versions should be written in package.json.
      Available styles:
        *	caret - Use ^ range for compatible updates (e.g. ^1.2.3)
        *	gt - Use >= to allow any newer version (e.g. >=1.2.3)
        *	lt - Use < to allow only lower versions (e.g. <1.2.3)
        *	pin - Use the exact version (e.g. 1.2.3)
        *	preserve - Retain the existing version range as-is
        *	tilde - Use ~ range for patch/minor updates (e.g. ~1.2.3)
      `
    },
    test: {
      type: 'boolean',
      default: true,
      description: 'Very the fix by running unit tests'
    },
    testScript: {
      type: 'string',
      default: 'test',
      description: 'The test script to run for each fix attempt'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdFix = {
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
    argv,
    config,
    importMeta,
    parentName
  })

  const wasBadInput = handleBadInput({
    test: RangeStyles.includes(cli.flags['rangeStyle'] as string),
    message: `Expecting range style of ${joinOr(RangeStyles)}`,
    pass: 'ok',
    fail: 'missing'
  })
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  await runFix({
    spinner,
    rangeStyle: (cli.flags['rangeStyle'] ?? undefined) as
      | RangeStyle
      | undefined,
    test: Boolean(cli.flags['test']),
    testScript: cli.flags['testScript'] as string | undefined
  })
}
