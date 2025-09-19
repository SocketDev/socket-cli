import path from 'node:path'

import terminalLink from 'terminal-link'

import { arrayUnique, joinOr } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { handleFix } from './handle-fix.mts'
import constants, {
  ERROR_UNABLE_RESOLVE_ORG,
  FLAG_ID,
} from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { RangeStyles } from '../../utils/semver.mts'
import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'
import type { RangeStyle } from '../../utils/semver.mts'

export const CMD_NAME = 'fix'

const DEFAULT_LIMIT = 10

const description = 'Update dependencies with "fixable" Socket alerts'

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
    Can be provided as comma separated values or as multiple flags`,
    isMultiple: true,
  },
  limit: {
    type: 'number',
    default: DEFAULT_LIMIT,
    description: `The number of fixes to attempt at a time (default ${DEFAULT_LIMIT})`,
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
  onlyCompute: {
    type: 'boolean',
    default: false,
    description:
      'Compute fixes only, do not apply them. Logs what upgrades would be applied. If combined with --output-file, the output file will contain the upgrades that would be applied.',
  },
  outputFile: {
    type: 'string',
    default: '',
    description: 'Path to store upgrades as a JSON file at this path.',
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
  glob: {
    type: 'string',
    default: '',
    description: 'Glob pattern to filter workspaces by',
    hidden: true,
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
      ${getFlagListOutput(config.flags)}

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

  const cli = meowOrExit({
    allowUnknownFlags: false,
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    autopilot,
    glob,
    json,
    limit,
    markdown,
    maxSatisfying,
    onlyCompute,
    outputFile,
    prCheck,
    rangeStyle,
    // We patched in this feature with `npx custompatch meow` at
    // socket-cli/patches/meow#13.2.0.patch.
    unknownFlags = [],
  } = cli.flags as {
    autopilot: boolean
    glob: string
    limit: number
    json: boolean
    markdown: boolean
    maxSatisfying: boolean
    minSatisfying: boolean
    prCheck: boolean
    rangeStyle: RangeStyle
    unknownFlags?: string[]
    outputFile: string
    onlyCompute: boolean
  }

  const dryRun = !!cli.flags['dryRun']

  const minSatisfying =
    (cli.flags['minSatisfying'] as boolean) || !maxSatisfying

  const outputKind = getOutputKind(json, markdown)

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

  const ghsas = arrayUnique([
    ...cmdFlagValueToArray(cli.flags['id']),
    ...cmdFlagValueToArray(cli.flags['ghsa']),
    ...cmdFlagValueToArray(cli.flags['purl']),
  ])

  await handleFix({
    autopilot,
    cwd,
    ghsas,
    glob,
    limit,
    minSatisfying,
    prCheck,
    orgSlug,
    outputKind,
    rangeStyle,
    spinner,
    unknownFlags,
    onlyCompute,
    outputFile,
  })
}
