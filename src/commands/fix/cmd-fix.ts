import { codeBlock } from 'common-tags'
import terminalLink from 'terminal-link'

import { joinOr } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { runFix } from './run-fix'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { RangeStyles } from '../../utils/semver'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'
import type { RangeStyle } from '../../utils/semver'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Fix "fixable" Socket alerts',
  hidden: true,
  flags: {
    ...commonFlags,
    autoPilot: {
      type: 'boolean',
      default: false,
      description: `Shorthand for --autoMerge --test`
    },
    autoMerge: {
      type: 'boolean',
      default: false,
      description: `Enable auto-merge for pull requests that Socket opens.\n                        See ${terminalLink(
        'GitHub documentation',
        'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository'
      )} for managing auto-merge for pull requests in your repository.`
    },
    purl: {
      type: 'string',
      default: [],
      description: `User provided PURL to fix`,
      isMultiple: true,
      shortFlag: 'p'
    },
    rangeStyle: {
      type: 'string',
      default: 'preserve',
      description: codeBlock`
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
      default: false,
      description: 'Verify the fix by running unit tests'
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
    autoMerge: Boolean(cli.flags['autoMerge']),
    autoPilot: Boolean(cli.flags['autoPilot']),
    purls: Array.isArray(cli.flags['purl']) ? cli.flags['purl'] : [],
    spinner,
    rangeStyle: (cli.flags['rangeStyle'] ?? undefined) as
      | RangeStyle
      | undefined,
    test: Boolean(cli.flags['test']),
    testScript: cli.flags['testScript'] as string | undefined
  })
}
