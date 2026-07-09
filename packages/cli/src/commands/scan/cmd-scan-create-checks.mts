import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'

import { reachabilityFlags } from './reachability-flags.mts'
import { InputError } from '../../util/error/errors.mts'
import { getEcosystemChoicesForMeow } from '../../util/ecosystem/types.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { ReachabilityTargetValidation } from './validate-reachability-target.mts'
import type { PURL_Type } from '../../util/ecosystem/types.mts'
import type { OutputKind } from '../../types.mjs'

export interface ReachabilityFlagUsageInput {
  reachAnalysisMemoryLimit: number
  reachAnalysisTimeout: number
  reachConcurrency: number
  reachDisableAnalytics: boolean
  reachEcosystems: PURL_Type[]
  reachEnableAnalysisSplitting: boolean
  reachExcludePaths: string[]
  reachLazyMode: boolean
  reachSkipCache: boolean
}

export interface ScanCreateInputCheckOptions {
  branchName: string
  hasApiToken: boolean
  isUsingAnyReachabilityFlags: boolean
  json: boolean
  makeDefaultBranch: boolean
  markdown: boolean
  orgSlug: string
  outputKind: OutputKind
  pendingHead: boolean
  reach: boolean
  reachTargetValidation: ReachabilityTargetValidation
  targets: string[]
}

/**
 * Detect whether any `--reach-*` flag was set to a non-default value, so
 * we can warn when reachability flags are used without `--reach`.
 */
export function computeReachabilityFlagUsage(
  options: ReachabilityFlagUsageInput,
): boolean {
  const {
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachConcurrency,
    reachDisableAnalytics,
    reachEcosystems,
    reachEnableAnalysisSplitting,
    reachExcludePaths,
    reachLazyMode,
    reachSkipCache,
  } = { __proto__: null, ...options } as typeof options

  const hasReachEcosystems = reachEcosystems.length > 0

  const hasReachExcludePaths = reachExcludePaths.length > 0

  const isUsingNonDefaultMemoryLimit =
    reachAnalysisMemoryLimit !==
    reachabilityFlags['reachAnalysisMemoryLimit']?.default

  const isUsingNonDefaultTimeout =
    reachAnalysisTimeout !== reachabilityFlags['reachAnalysisTimeout']?.default

  const isUsingNonDefaultConcurrency =
    reachConcurrency !== reachabilityFlags['reachConcurrency']?.default

  const isUsingNonDefaultAnalytics =
    reachDisableAnalytics !==
    reachabilityFlags['reachDisableAnalytics']?.default

  return (
    hasReachEcosystems ||
    hasReachExcludePaths ||
    isUsingNonDefaultAnalytics ||
    isUsingNonDefaultConcurrency ||
    isUsingNonDefaultMemoryLimit ||
    isUsingNonDefaultTimeout ||
    reachEnableAnalysisSplitting ||
    reachLazyMode ||
    reachSkipCache
  )
}

/**
 * Validate `--reach-ecosystems` values against the supported ecosystem list.
 */
export function validateReachEcosystems(rawValues: string[]): PURL_Type[] {
  const reachEcosystems: PURL_Type[] = []
  const validEcosystems = getEcosystemChoicesForMeow()
  for (let i = 0, { length } = rawValues; i < length; i += 1) {
    const ecosystem = rawValues[i]!
    if (!validEcosystems.includes(ecosystem)) {
      throw new InputError(
        `--reach-ecosystems must be one of: ${joinAnd(validEcosystems)} (saw: "${ecosystem}"); pass a supported ecosystem like --reach-ecosystems=${validEcosystems[0]}`,
      )
    }
    reachEcosystems.push(ecosystem as PURL_Type)
  }
  return reachEcosystems
}

/**
 * Run the full `socket scan create` input-validation checklist (org, target,
 * output-format, api-token, and reachability constraints).
 */
export function validateScanCreateInput(
  options: ScanCreateInputCheckOptions,
): boolean {
  const {
    branchName,
    hasApiToken,
    isUsingAnyReachabilityFlags,
    json,
    makeDefaultBranch,
    markdown,
    orgSlug,
    outputKind,
    pendingHead,
    reach,
    reachTargetValidation,
    targets,
  } = { __proto__: null, ...options } as typeof options

  return checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
    },
    {
      test: !!targets.length,
      message: 'At least one TARGET (e.g. `.` or `./package.json`)',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
    {
      nook: true,
      test: !makeDefaultBranch || !!branchName,
      message: 'When --make-default-branch is set, --branch is mandatory',
      fail: 'missing branch name',
    },
    {
      nook: true,
      test: !pendingHead || !!branchName,
      message: 'When --pending-head is set, --branch is mandatory',
      fail: 'missing branch name',
    },
    {
      nook: true,
      test: reach || !isUsingAnyReachabilityFlags,
      message: 'Reachability analysis flags require --reach to be enabled',
      fail: 'add --reach flag to use --reach-* options',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.isValid,
      message:
        'Reachability analysis requires exactly one target directory when --reach is enabled',
      fail: 'provide exactly one directory path',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.isDirectory,
      message:
        'Reachability analysis target must be a directory when --reach is enabled',
      fail: 'provide a directory path, not a file',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.targetExists,
      message: 'Target directory must exist when --reach is enabled',
      fail: 'provide an existing directory path',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.isInsideCwd,
      message:
        'Target directory must be inside the current working directory when --reach is enabled',
      fail: 'provide a path inside the working directory',
    },
  )
}
