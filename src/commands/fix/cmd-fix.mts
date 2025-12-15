import path from 'node:path'

import terminalLink from 'terminal-link'

import {
  arrayUnique,
  joinAnd,
  joinOr,
} from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { handleFix } from './handle-fix.mts'
import constants, {
  ERROR_UNABLE_RESOLVE_ORG,
  FLAG_ID,
} from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { RangeStyles } from '../../utils/semver.mts'
import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'
import type { RangeStyle } from '../../utils/semver.mts'

export const CMD_NAME = 'fix'

const DEFAULT_LIMIT = 10

const description = 'Fix CVEs in dependencies'

const hidden = false

export const cmdFix = {
  description,
  hidden,
  run,
}

const generalFlags: MeowFlags = {
  autopilot: {
    type: 'boolean',
    default: false,
    description: `Enable auto-merge for pull requests that Socket opens.\nSee ${terminalLink(
      'GitHub documentation',
      'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository',
    )} for managing auto-merge for pull requests in your repository.`,
  },
  fixVersion: {
    type: 'string',
    description: `Override the version of @coana-tech/cli used for fix analysis. Default: ${constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}.`,
  },
  applyFixes: {
    aliases: ['onlyCompute'],
    type: 'boolean',
    default: true,
    description:
      'Compute fixes only, do not apply them. Logs what upgrades would be applied. If combined with --output-file, the output file will contain the upgrades that would be applied.',
    // Hidden to allow custom documenting of the negated `--no-apply-fixes` variant.
    hidden: true,
  },
  exclude: {
    type: 'string',
    default: [],
    description:
      'Exclude workspaces matching these glob patterns. Can be provided as comma separated values or as multiple flags',
    isMultiple: true,
    hidden: false,
  },
  include: {
    type: 'string',
    default: [],
    description:
      'Include workspaces matching these glob patterns. Can be provided as comma separated values or as multiple flags',
    isMultiple: true,
    hidden: false,
  },
  majorUpdates: {
    type: 'boolean',
    default: true,
    description:
      'Allow major version updates. Use --no-major-updates to disable.',
    // Hidden to allow custom documenting of the negated `--no-major-updates` variant.
    hidden: true,
  },
  all: {
    type: 'boolean',
    default: false,
    description:
      'Process all discovered vulnerabilities in local mode. Cannot be used with --id.',
  },
  id: {
    type: 'string',
    default: [],
    description: `Provide a list of vulnerability identifiers to compute fixes for:
    - ${terminalLink(
      'GHSA IDs',
      'https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids',
    )} (e.g., GHSA-xxxx-xxxx-xxxx)
    - ${terminalLink(
      'CVE IDs',
      'https://cve.mitre.org/cve/identifiers/',
    )} (e.g., CVE-${new Date().getFullYear()}-1234) - automatically converted to GHSA
    - ${terminalLink(
      'PURLs',
      'https://github.com/package-url/purl-spec',
    )} (e.g., pkg:npm/package@1.0.0) - automatically converted to GHSA
    Can be provided as comma separated values or as multiple flags. Cannot be used with --all.`,
    isMultiple: true,
  },
  prLimit: {
    aliases: ['limit'],
    type: 'number',
    default: DEFAULT_LIMIT,
    description: `Maximum number of pull requests to create in CI mode (default ${DEFAULT_LIMIT}). Has no effect in local mode.`,
  },
  rangeStyle: {
    type: 'string',
    default: 'preserve',
    description: `
Define how dependency version ranges are updated in package.json (default 'preserve').
Available styles:
  * pin - Use the exact version (e.g. 1.2.3)
  * preserve - Retain the existing version range style as-is
      `.trim(),
  },
  outputFile: {
    type: 'string',
    default: '',
    description: 'Path to store upgrades as a JSON file at this path.',
  },
  minimumReleaseAge: {
    type: 'string',
    default: '',
    description:
      'Set a minimum age requirement for suggested upgrade versions (e.g., 1h, 2d, 3w). A higher age requirement reduces the risk of upgrading to malicious versions. For example, setting the value to 1 week (1w) gives ecosystem maintainers one week to remove potentially malicious versions.',
  },
  debug: {
    type: 'boolean',
    default: false,
    description:
      'Enable debug logging in the Coana-based Socket Fix CLI invocation.',
    shortFlag: 'd',
  },
  ecosystems: {
    type: 'string',
    default: [],
    description:
      'Limit fix analysis to specific ecosystems. Can be provided as comma separated values or as multiple flags. Defaults to all ecosystems.',
    isMultiple: true,
  },
  showAffectedDirectDependencies: {
    type: 'boolean',
    default: false,
    description:
      'List the direct dependencies responsible for introducing transitive vulnerabilities and list the updates required to resolve the vulnerabilities',
  },
}

const hiddenFlags: MeowFlags = {
  autoMerge: {
    ...generalFlags['autopilot'],
    hidden: true,
  } as MeowFlag,
  ghsa: {
    ...generalFlags['id'],
    hidden: true,
  } as MeowFlag,
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
    hidden: true,
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
    )} to compute fixes for, as either a comma separated value or as\nmultiple flags`,
    isMultiple: true,
    shortFlag: 'p',
    hidden: true,
  },
  test: {
    type: 'boolean',
    default: false,
    description: 'Verify the fix by running unit tests',
    hidden: true,
  },
  testScript: {
    type: 'string',
    default: 'test',
    description: "The test script to run for fix attempts (default 'test')",
    hidden: true,
  },
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
      ...outputFlags,
      ...generalFlags,
      ...hiddenFlags,
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput({
        ...config.flags,
        // Explicitly document the negated --no-apply-fixes variant.
        noApplyFixes: {
          ...config.flags['applyFixes'],
          hidden: false,
        } as MeowFlag,
        // Explicitly document the negated --no-major-updates variant.
        noMajorUpdates: {
          ...config.flags['majorUpdates'],
          description:
            'Do not suggest or apply fixes that require major version updates of direct or transitive dependencies',
          hidden: false,
        } as MeowFlag,
      })}

    Environment Variables (for CI/PR mode)
      CI                          Set to enable CI mode
      SOCKET_CLI_GITHUB_TOKEN     GitHub token for PR creation (or GITHUB_TOKEN)
      SOCKET_CLI_GIT_USER_NAME    Git username for commits
      SOCKET_CLI_GIT_USER_EMAIL   Git email for commits

    Examples
      $ ${command}
      $ ${command} ${FLAG_ID} CVE-2021-23337
      $ ${command} ./path/to/project --range-style pin
    `,
  }

  const cli = meowOrExit(
    {
      argv,
      config,
      parentName,
      importMeta,
    },
    { allowUnknownFlags: false },
  )

  const {
    all,
    applyFixes,
    autopilot,
    debug,
    ecosystems,
    exclude,
    fixVersion,
    include,
    json,
    majorUpdates,
    markdown,
    maxSatisfying,
    minimumReleaseAge,
    outputFile,
    prCheck,
    prLimit,
    rangeStyle,
    showAffectedDirectDependencies,
    // We patched in this feature with `npx custompatch meow` at
    // socket-cli/patches/meow#13.2.0.patch.
    unknownFlags = [],
  } = cli.flags as {
    all: boolean
    applyFixes: boolean
    autopilot: boolean
    debug: boolean
    ecosystems: string[]
    exclude: string[]
    fixVersion: string | undefined
    include: string[]
    json: boolean
    majorUpdates: boolean
    markdown: boolean
    maxSatisfying: boolean
    minSatisfying: boolean
    minimumReleaseAge: string
    outputFile: string
    prCheck: boolean
    prLimit: number
    rangeStyle: RangeStyle
    showAffectedDirectDependencies: boolean
    unknownFlags?: string[]
  }

  const dryRun = !!cli.flags['dryRun']

  const minSatisfying =
    (cli.flags['minSatisfying'] as boolean) || !maxSatisfying

  const disableMajorUpdates = !majorUpdates

  const outputKind = getOutputKind(json, markdown)

  // Process comma-separated values for ecosystems flag.
  const ecosystemsRaw = cmdFlagValueToArray(ecosystems)

  // Validate ecosystem values early, before dry-run check.
  const validatedEcosystems: PURL_Type[] = []
  const validEcosystemChoices = getEcosystemChoicesForMeow()
  for (const ecosystem of ecosystemsRaw) {
    if (!validEcosystemChoices.includes(ecosystem)) {
      logger.fail(
        `Invalid ecosystem: "${ecosystem}". Valid values are: ${joinAnd(validEcosystemChoices)}`,
      )
      process.exitCode = 1
      return
    }
    validatedEcosystems.push(ecosystem as PURL_Type)
  }

  // Collect ghsas early to validate --all and --id mutual exclusivity.
  const ghsas = arrayUnique([
    ...cmdFlagValueToArray(cli.flags['id']),
    ...cmdFlagValueToArray(cli.flags['ghsa']),
    ...cmdFlagValueToArray(cli.flags['purl']),
  ])

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: RangeStyles.includes(rangeStyle),
      message: `Expecting range style of ${joinOr(RangeStyles)}`,
      fail: 'invalid',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: !all || !ghsas.length,
      message: 'The --all and --id flags cannot be used together',
      fail: 'omit one',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_NOT_SAVING)
    return
  }

  const orgSlugCResult = await getDefaultOrgSlug()
  if (!orgSlugCResult.ok) {
    process.exitCode = orgSlugCResult.code ?? 1
    logger.fail(
      `${ERROR_UNABLE_RESOLVE_ORG}.\nEnsure a Socket API token is specified for the organization using the SOCKET_CLI_API_TOKEN environment variable.`,
    )
    return
  }

  const orgSlug = orgSlugCResult.data

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const { spinner } = constants

  const includePatterns = cmdFlagValueToArray(include)
  const excludePatterns = cmdFlagValueToArray(exclude)

  await handleFix({
    all,
    applyFixes,
    autopilot,
    coanaVersion: fixVersion,
    cwd,
    debug,
    disableMajorUpdates,
    ecosystems: validatedEcosystems,
    exclude: excludePatterns,
    ghsas,
    include: includePatterns,
    minimumReleaseAge,
    minSatisfying,
    orgSlug,
    outputFile,
    outputKind,
    prCheck,
    prLimit,
    rangeStyle,
    showAffectedDirectDependencies,
    spinner,
    unknownFlags,
  })
}
