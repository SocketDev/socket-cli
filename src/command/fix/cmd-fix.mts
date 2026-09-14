// CLI output formatting: multi-line user-facing messages where embedded \n
// produces the intended layout. Splitting into logger.log("") + logger.log(...)
// pairs is the canonical rewrite but doesnt preserve the visual flow for these
// specific outputs.
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- intended layout */
import { existsSync } from 'node:fs'
import path from 'node:path'

import { joinAnd, joinOr } from '@socketsecurity/lib-stable/arrays/join'
import { arrayUnique } from '@socketsecurity/lib-stable/arrays/unique'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

import { generalFlags, hiddenFlags } from './cmd-fix-flags.mts'
import { handleFix } from './handle-fix.mts'
import { FLAG_ID } from '../../constants/cli.mts'
import { ERROR_UNABLE_RESOLVE_ORG } from '../../constants/errors.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { outputDryRunPreview } from '../../util/dry-run/output.mts'
import {
  COANA_PACKAGE_MANAGERS,
  isCoanaPackageManager,
} from '../../util/ecosystem/coana-package-managers.mts'
import { getEcosystemChoicesForMeow } from '../../util/ecosystem/types.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { cmdFlagValueToArray } from '../../util/process/cmd.mts'
import { RangeStyles } from '../../util/semver.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'
import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mts'
import { assertNoNegationPatterns } from '../scan/exclude-paths.mts'

import type { DryRunAction } from '../../util/dry-run/output.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'
import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { PURL_Type } from '../../util/ecosystem/types.mts'
import type { RangeStyle } from '../../util/semver.mts'
const logger = getDefaultLogger()

// Flags interface for type safety.
export interface FixFlags {
  all: boolean
  applyFixes: boolean
  autopilot: boolean
  debug: boolean
  disableExternalToolChecks: boolean
  ecosystems: string[]
  exclude: string[]
  excludePaths: string[]
  packageManagers: string[]
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
  silence: boolean
  unknownFlags?: string[] | undefined
}

export const CMD_NAME = 'fix'

const description = 'Fix CVEs in dependencies'

const hidden = false

export const cmdFix = {
  description,
  hidden,
  run,
}

export function normalizeFixEcosystems(
  ecosystems: string[],
): PURL_Type[] | undefined {
  const values = cmdFlagValueToArray(ecosystems).map(value =>
    value.toLowerCase(),
  )
  const choices = getEcosystemChoicesForMeow()
  const validated: PURL_Type[] = []
  for (let i = 0, { length } = values; i < length; i += 1) {
    const ecosystem = values[i]!
    if (!choices.includes(ecosystem)) {
      logger.fail(
        `--ecosystems must be one of: ${joinAnd(choices)} (saw: "${ecosystem}"); pass a supported ecosystem like --ecosystems=${choices[0]}`,
      )
      process.exitCode = 1
      return undefined
    }
    validated.push(ecosystem as PURL_Type)
  }
  return validated
}

export function normalizeFixPackageManagers(
  packageManagers: string[],
): string[] | undefined {
  const values = cmdFlagValueToArray(packageManagers).map(value =>
    value.toUpperCase(),
  )
  const validated: string[] = []
  for (let i = 0, { length } = values; i < length; i += 1) {
    const packageManager = values[i]!
    if (!isCoanaPackageManager(packageManager)) {
      logger.fail(
        `--package-managers must be one of: ${joinAnd([...COANA_PACKAGE_MANAGERS])} (saw: "${packageManager}"); pass a supported package manager like --package-managers=${COANA_PACKAGE_MANAGERS[0]}`,
      )
      process.exitCode = 1
      return undefined
    }
    validated.push(packageManager)
  }
  return validated
}

export function outputFixDryRun(
  options?:
    | {
        all?: boolean | undefined
        applyFixes?: boolean | undefined
        cwd?: string | undefined
        disableMajorUpdates?: boolean | undefined
        ecosystems?: readonly PURL_Type[] | undefined
        ghsas?: readonly string[] | undefined
        orgSlug?: string | undefined
        rangeStyle?: RangeStyle | undefined
      }
    | undefined,
): void {
  const {
    all,
    applyFixes,
    cwd,
    disableMajorUpdates,
    ecosystems = [],
    ghsas = [],
    orgSlug,
    rangeStyle,
  } = { __proto__: null, ...options }
  const actions: DryRunAction[] = [
    {
      type: 'fetch',
      description: 'Scan project dependencies for vulnerabilities',
      target: cwd,
      details: {
        organization: orgSlug,
        ecosystems: ecosystems.length ? ecosystems.join(', ') : 'all',
      },
    },
    {
      type: 'fetch',
      description: 'Analyze vulnerability fix options',
      details: {
        targets: all
          ? 'all vulnerabilities'
          : ghsas.length
            ? ghsas.join(', ')
            : 'auto-discovered',
        majorUpdates: disableMajorUpdates ? 'disabled' : 'enabled',
        rangeStyle,
      },
    },
  ]
  if (applyFixes) {
    actions.push(
      {
        type: 'modify',
        description: 'Update package manifest files with fixes',
        target: 'package.json and lock files',
      },
      {
        type: 'execute',
        description: 'Run package manager to install updated dependencies',
      },
    )
  }
  const targetDescription = all
    ? 'all vulnerabilities'
    : ghsas.length
      ? `${ghsas.length} specified ${pluralize('vulnerability', { count: ghsas.length })}`
      : 'discovered vulnerabilities'
  const fixModeDescription = applyFixes
    ? 'compute and apply fixes'
    : 'compute fixes only (not applying)'
  outputDryRunPreview({
    summary: `Analyze and ${fixModeDescription} for ${targetDescription}`,
    actions,
    wouldSucceed: true,
  })
}

export function rejectPositionalVulnerability(
  rawInput: string | undefined,
): boolean {
  if (!rawInput) {
    return false
  }
  const upperInput = rawInput.toUpperCase()
  const isGhsa = upperInput.startsWith('GHSA-')
  const isCve = upperInput.startsWith('CVE-')
  const isPurl = rawInput.startsWith('pkg:')
  if (!isCve && !isGhsa && !isPurl) {
    return false
  }
  const suggestion = isGhsa
    ? 'GHSA-' + rawInput.slice(5).toLowerCase()
    : isCve
      ? 'CVE-' + rawInput.slice(4)
      : rawInput
  logger.fail(
    `"${rawInput}" looks like a vulnerability identifier, not a directory path.\nDid you mean: socket fix ${FLAG_ID} ${suggestion}`,
  )
  process.exitCode = 1
  return true
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
      ...outputFlags,
      ...generalFlags,
      ...hiddenFlags,
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput({
        ...helpConfig.flags,
        // Explicitly document the negated --no-apply-fixes variant.
        noApplyFixes: {
          ...helpConfig.flags['applyFixes'],
          hidden: false,
        } as MeowFlag,
        // Explicitly document the negated --no-major-updates variant.
        noMajorUpdates: {
          ...helpConfig.flags['majorUpdates'],
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
    { allowUnknownFlags: true },
  )

  const {
    all,
    applyFixes,
    autopilot,
    debug,
    disableExternalToolChecks,
    ecosystems,
    exclude,
    excludePaths,
    fixVersion,
    packageManagers,
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
    silence,
    // We patched in this feature with `npx custompatch meow` at
    // socket-cli/patches/meow#13.2.0.patch.
    unknownFlags = [],
  } = cli.flags as unknown as FixFlags

  const dryRun = cli.flags['dryRun']

  const minSatisfying =
    (cli.flags as unknown as FixFlags).minSatisfying || !maxSatisfying

  const disableMajorUpdates = !majorUpdates

  const outputKind = getOutputKind(json, markdown)

  // Process comma-separated values for ecosystems flag. The choice list is
  // lowercase, so normalize the input for a case-insensitive match.
  const validatedEcosystems = normalizeFixEcosystems(ecosystems)
  if (validatedEcosystems === undefined) {
    return
  }

  // Coana uppercases --package-managers input and rejects unknown values, so
  // normalize and validate here for the same UX and an early failure.
  const validatedPackageManagers = normalizeFixPackageManagers(packageManagers)
  if (validatedPackageManagers === undefined) {
    return
  }

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

  // Detect the common mistake of passing a vulnerability ID (GHSA / CVE /
  // PURL) as a positional argument when the user meant to use `--id`.
  // Without this guard we treat the ID as a directory path, resolve to cwd,
  // and eventually fail with a confusing upload error. Run this before
  // `getDefaultOrgSlug()` so users still get the helpful message when no
  // API token is configured.
  if (rejectPositionalVulnerability(cli.input[0])) {
    return
  }

  let { 0: cwd = '.' } = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  // Validate the target directory exists so we fail fast with a clear
  // message instead of the API's "Need at least one file to be uploaded".
  // Also runs before the org-slug resolution so the user sees a clearer
  // error when pointing at a typo'd path without an API token set.
  if (!existsSync(cwd)) {
    logger.fail(`Target directory does not exist: ${cwd}`)
    process.exitCode = 1
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

  const spinner = undefined

  const includePatterns = cmdFlagValueToArray(include)
  const excludePatterns = cmdFlagValueToArray(exclude)
  const excludePathsPatterns = cmdFlagValueToArray(excludePaths)
  try {
    assertNoNegationPatterns(excludePathsPatterns)
  } catch (e) {
    logger.fail((e as Error).message)
    process.exitCode = 1
    return
  }

  if (dryRun) {
    outputFixDryRun({
      all,
      applyFixes,
      cwd,
      disableMajorUpdates,
      ecosystems: validatedEcosystems,
      ghsas,
      orgSlug,
      rangeStyle,
    })
    return
  }

  await handleFix({
    all,
    applyFixes,
    autopilot,
    coanaVersion: fixVersion,
    cwd,
    debug,
    disableExternalToolChecks: disableExternalToolChecks,
    disableMajorUpdates,
    ecosystems: validatedEcosystems,
    exclude: excludePatterns,
    excludePaths: excludePathsPatterns,
    ghsas,
    include: includePatterns,
    minimumReleaseAge,
    minSatisfying,
    orgSlug,
    outputFile,
    outputKind,
    packageManagers: validatedPackageManagers,
    prCheck,
    prLimit,
    rangeStyle,
    showAffectedDirectDependencies,
    silence,
    spinner,
    unknownFlags,
  })
}
