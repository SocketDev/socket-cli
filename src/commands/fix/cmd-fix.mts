import path from 'node:path'

import { PackageURL } from 'packageurl-js'
import terminalLink from 'terminal-link'

import { joinOr } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { handleFix } from './handle-fix.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { RangeStyles } from '../../utils/semver.mts'
import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'
import type { RangeStyle } from '../../utils/semver.mts'

const { DRY_RUN_NOT_SAVING } = constants

const DEFAULT_LIMIT = 10

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Update dependencies with "fixable" Socket alerts',
  hidden: false,
  flags: {
    ...commonFlags,
    autoMerge: {
      type: 'boolean',
      default: false,
      description: `Enable auto-merge for pull requests that Socket opens.\nSee ${terminalLink(
        'GitHub documentation',
        'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository',
      )} for managing auto-merge for pull requests in your repository.`,
    },
    autopilot: {
      type: 'boolean',
      default: false,
      description: `Shorthand for --autoMerge --test`,
    },
    ghsa: {
      type: 'string',
      default: [],
      description: `Provide a list of ${terminalLink(
        'GHSA IDs',
        'https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids',
      )} to compute fixes for, as either a comma separated value or as multiple flags.\nUse '--ghsa all' to lookup all GHSA IDs and compute fixes for them.`,
      isMultiple: true,
      hidden: true,
    },
    limit: {
      type: 'number',
      default: DEFAULT_LIMIT,
      description: `The number of fixes to attempt at a time (default ${DEFAULT_LIMIT})`,
    },
    maxSatisfying: {
      type: 'boolean',
      default: true,
      description: 'Use the maximum satisfying version for dependency updates',
      hidden: true,
    },
    minSatisfying: {
      type: 'boolean',
      default: false,
      description:
        'Constrain dependency updates to the minimum satisfying version',
    },
    prCheck: {
      type: 'boolean',
      default: true,
      description: 'Check for an existing PR before attempting a fix',
      hidden: true,
    },
    purl: {
      type: 'string',
      default: [],
      description: `Provide a list of ${terminalLink(
        'PURLs',
        'https://github.com/package-url/purl-spec?tab=readme-ov-file#purl',
      )} to compute fixes for, as either a comma separated value or as\nmultiple flags, instead of querying the Socket API`,
      isMultiple: true,
      shortFlag: 'p',
    },
    rangeStyle: {
      type: 'string',
      default: 'preserve',
      description: `
Define how dependency version ranges are updated in package.json (default 'preserve').
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
      description: "The test script to run for fix attempts (default 'test')",
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

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
    allowUnknownFlags: false,
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  let rangeStyle = cli.flags['rangeStyle'] as RangeStyle
  if (!rangeStyle) {
    rangeStyle = 'preserve'
  }

  const rawPurls = cmdFlagValueToArray(cli.flags['purl'])
  const purls = []
  for (const purl of rawPurls) {
    let version
    try {
      version = PackageURL.fromString(purl)?.version
    } catch {}
    if (version) {
      purls.push(purl)
    } else {
      logger.warn(`--purl ${purl} is missing a version and will be ignored.`)
    }
  }
  if (rawPurls.length !== purls.length && !purls.length) {
    process.exitCode = 1
    logger.fail('No valid --purl values provided.')
    return
  }

  const outputKind = getOutputKind(cli.flags['json'], cli.flags['markdown'])

  const wasValidInput = checkCommandInput(outputKind, {
    test: RangeStyles.includes(rangeStyle),
    message: `Expecting range style of ${joinOr(RangeStyles)}`,
    fail: 'invalid',
  })
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_NOT_SAVING)
    return
  }

  const orgSlugCResult = await getDefaultOrgSlug()
  if (!orgSlugCResult.ok) {
    process.exitCode = orgSlugCResult.code ?? 1
    logger.fail(
      'Unable to resolve a Socket account organization.\nEnsure a Socket API token is specified for the organization using the SOCKET_CLI_API_TOKEN environment variable.',
    )
    return
  }

  const orgSlug = orgSlugCResult.data

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  let autoMerge = Boolean(cli.flags['autoMerge'])
  let test = Boolean(cli.flags['test'])
  if (cli.flags['autopilot']) {
    autoMerge = true
    test = true
  }

  // Lazily access constants.spinner.
  const { spinner } = constants
  // We patched in this feature with `npx custompatch meow` at
  // socket-cli/patches/meow#13.2.0.patch.
  const unknownFlags = cli.unknownFlags ?? []

  const ghsas = cmdFlagValueToArray(cli.flags['ghsa'])
  const limit = Number(cli.flags['limit']) || DEFAULT_LIMIT
  const maxSatisfying = Boolean(cli.flags['maxSatisfying'])
  const minSatisfying = Boolean(cli.flags['minSatisfying']) || !maxSatisfying
  const prCheck = Boolean(cli.flags['prCheck'])
  const testScript = String(cli.flags['testScript'] || 'test')

  await handleFix({
    autoMerge,
    cwd,
    ghsas,
    limit,
    minSatisfying,
    prCheck,
    orgSlug,
    outputKind,
    purls,
    rangeStyle,
    spinner,
    test,
    testScript,
    unknownFlags,
  })
}
