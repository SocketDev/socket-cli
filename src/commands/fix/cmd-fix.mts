import path from 'node:path'

import terminalLink from 'terminal-link'

import { joinOr } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { handleFix } from './handle-fix.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { RangeStyles } from '../../utils/semver.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'
import type { RangeStyle } from '../../utils/semver.mts'

const { DRY_RUN_NOT_SAVING } = constants

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Update dependencies with "fixable" Socket alerts',
  hidden: false,
  flags: {
    ...commonFlags,
    autoMerge: {
      type: 'boolean',
      default: false,
      description: `Enable auto-merge for pull requests that Socket opens.\n                        See ${terminalLink(
        'GitHub documentation',
        'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository',
      )} for managing auto-merge for pull requests in your repository.`,
    },
    autopilot: {
      type: 'boolean',
      default: false,
      description: `Shorthand for --autoMerge --test`,
    },
    limit: {
      type: 'number',
      default: Infinity,
      description: 'The number of fixes to attempt at a time',
    },
    purl: {
      type: 'string',
      default: [],
      description: `Provide a list of ${terminalLink(
        'package URLs',
        'https://github.com/package-url/purl-spec?tab=readme-ov-file#purl',
      )} (PURLs) to fix, as either a comma separated value or as multiple flags,\n                        instead of querying the Socket API`,
      isMultiple: true,
      shortFlag: 'p',
    },
    rangeStyle: {
      type: 'string',
      default: 'preserve',
      description: `
                        Define how updated dependency versions should be written in package.json.
                        Available styles:
                          * caret - Use ^ range for compatible updates (e.g. ^1.2.3)
                          * gt - Use > to allow any newer version (e.g. >1.2.3)
                          * gte - Use >= to allow any newer version (e.g. >=1.2.3)
                          * lt - Use < to allow only lower versions (e.g. <1.2.3)
                          * lte - Use <= to allow only lower versions (e.g. <=1.2.3)
                          * pin - Use the exact version (e.g. 1.2.3)
                          * preserve - Retain the existing version range style as-is
                          * tilde - Use ~ range for patch/minor updates (e.g. ~1.2.3)
      `.trim(),
    },
    test: {
      type: 'boolean',
      default: false,
      description: 'Verify the fix by running unit tests',
    },
    testScript: {
      type: 'string',
      default: 'test',
      description: 'The test script to run for each fix attempt',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} ./proj/tree --autoMerge
  `,
}

export const cmdFix = {
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

  const { autopilot, json, markdown } = cli.flags as {
    autopilot: boolean
    json: boolean
    markdown: boolean
  }
  const outputKind = getOutputKind(json, markdown)

  let rangeStyle = cli.flags['rangeStyle'] as RangeStyle
  if (!rangeStyle) {
    rangeStyle = 'preserve'
  }

  const wasValidInput = checkCommandInput(outputKind, {
    test: RangeStyles.includes(rangeStyle),
    message: `Expecting range style of ${joinOr(RangeStyles)}`,
    pass: 'ok',
    fail: 'invalid',
  })
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_NOT_SAVING)
    return
  }

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  let autoMerge = Boolean(cli.flags['autoMerge'])
  let test = Boolean(cli.flags['test'])
  if (autopilot) {
    autoMerge = true
    test = true
  }

  const limit =
    (cli.flags['limit']
      ? parseInt(String(cli.flags['limit'] || ''), 10)
      : Infinity) || Infinity

  const purls: string[] = Array.isArray(cli.flags['purl'])
    ? cli.flags['purl'].flatMap(p => p.split(/, */))
    : []

  const testScript = String(cli.flags['testScript'] || 'test')

  await handleFix({
    autoMerge,
    cwd,
    limit,
    outputKind,
    purls,
    rangeStyle,
    test,
    testScript,
  })
}
