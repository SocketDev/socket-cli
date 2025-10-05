/** @fileoverview Reachability analysis performer for Socket CLI. Executes reachability analysis using Coana integration to identify unused code paths in dependencies. Requires enterprise organization plan. */

import path from 'node:path'

import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { spawnCoana } from '../../utils/coana-spawn.mts'
import { extractTier1ReachabilityScanId } from '../../utils/coana.mts'
import { hasEnterpriseOrgPlan } from '../../utils/organization.mts'
import { setupSdk } from '../../utils/sdk.mts'
import {
  withExternalSpinner,
  withSpinnerRestore,
} from '../../utils/spinner.mts'
import { socketDevLink } from '../../utils/terminal-link.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult } from '../../types.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type ReachabilityOptions = {
  reachAnalysisTimeout: number
  reachAnalysisMemoryLimit: number
  reachDisableAnalytics: boolean
  reachEcosystems: PURL_Type[]
  reachExcludePaths: string[]
  reachSkipCache: boolean
}

export type ReachabilityAnalysisOptions = {
  branchName?: string | undefined
  cwd?: string | undefined
  orgSlug?: string | undefined
  packagePaths?: string[] | undefined
  reachabilityOptions: ReachabilityOptions
  repoName?: string | undefined
  spinner?: Spinner | undefined
  uploadManifests?: boolean | undefined
}

export type ReachabilityAnalysisResult = {
  reachabilityReport: string
  tier1ReachabilityScanId: string | undefined
}

export async function performReachabilityAnalysis(
  options?: ReachabilityAnalysisOptions | undefined,
): Promise<CResult<ReachabilityAnalysisResult>> {
  const {
    branchName,
    cwd = process.cwd(),
    orgSlug,
    packagePaths,
    reachabilityOptions,
    repoName,
    spinner,
    uploadManifests = true,
  } = { __proto__: null, ...options } as ReachabilityAnalysisOptions

  // Check if user has enterprise plan for reachability analysis.
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    return {
      ok: false,
      message: 'Unable to verify plan permissions',
      cause:
        'Failed to fetch organization information to verify enterprise plan access',
    }
  }

  const { organizations } = orgsCResult.data

  if (!hasEnterpriseOrgPlan(organizations)) {
    return {
      ok: false,
      message: 'Tier 1 Reachability analysis requires an enterprise plan',
      cause: `Please ${socketDevLink('upgrade your plan', '/pricing')}. This feature is only available for organizations with an enterprise plan.`,
    }
  }

  const wasSpinning = !!spinner?.isSpinning

  let tarHash: string | undefined

  if (uploadManifests && orgSlug && packagePaths) {
    const uploadResult = await withSpinnerRestore(
      spinner,
      wasSpinning,
      async ():
        | Promise<CResult<never>>
        | Promise<{ ok: true; hash: string }> => {
        // Setup SDK for uploading manifests
        const sockSdkCResult = await setupSdk()
        if (!sockSdkCResult.ok) {
          return sockSdkCResult
        }

        const sockSdk = sockSdkCResult.data

        // Exclude any .socket.facts.json files that happen to be in the scan
        // folder before the analysis was run.
        const filepathsToUpload = packagePaths.filter(
          p =>
            path.basename(p).toLowerCase() !==
            constants.DOT_SOCKET_DOT_FACTS_JSON,
        )

        const uploadCResult = await withExternalSpinner(
          spinner,
          'Uploading manifests for reachability analysis...',
          async () => {
            return await handleApiCall(
              sockSdk.uploadManifestFiles(orgSlug, filepathsToUpload),
              {
                description: 'upload manifests',
                spinner,
              },
            )
          },
        )

        if (!uploadCResult.ok) {
          return uploadCResult
        }

        const hash = (uploadCResult.data as { tarHash?: string })?.tarHash
        if (!hash) {
          return {
            ok: false as const,
            message: 'Failed to get manifest tar hash',
            cause:
              'Server did not return a tar hash for the uploaded manifests',
          }
        }

        spinner?.start()
        spinner?.success(`Manifests uploaded successfully. Tar hash: ${hash}`)

        return { ok: true as const, hash }
      },
    )

    if (!uploadResult.ok) {
      return uploadResult
    }

    tarHash = uploadResult.hash
  }

  spinner?.start()
  spinner?.infoAndStop('Running reachability analysis with Coana...')

  // Build Coana arguments.
  const coanaArgs = [
    'run',
    cwd,
    '--output-dir',
    cwd,
    '--socket-mode',
    constants.DOT_SOCKET_DOT_FACTS_JSON,
    '--disable-report-submission',
    ...(reachabilityOptions.reachAnalysisTimeout
      ? ['--analysis-timeout', `${reachabilityOptions.reachAnalysisTimeout}`]
      : []),
    ...(reachabilityOptions.reachAnalysisMemoryLimit
      ? ['--memory-limit', `${reachabilityOptions.reachAnalysisMemoryLimit}`]
      : []),
    ...(reachabilityOptions.reachDisableAnalytics
      ? ['--disable-analytics-sharing']
      : []),
    ...(tarHash
      ? ['--run-without-docker', '--manifests-tar-hash', tarHash]
      : []),
    // Empty reachEcosystems implies scanning all ecosystems.
    ...(reachabilityOptions.reachEcosystems.length
      ? ['--purl-types', ...reachabilityOptions.reachEcosystems]
      : []),
    ...(reachabilityOptions.reachExcludePaths.length
      ? ['--exclude-dirs', ...reachabilityOptions.reachExcludePaths]
      : []),
    ...(reachabilityOptions.reachSkipCache ? ['--skip-cache-usage'] : []),
  ]

  // Build environment variables.
  const coanaEnv: Record<string, string> = {}
  // do not pass default repo and branch name to coana to avoid mixing
  // buckets (cached configuration) from projects that are likely very different.
  if (repoName && repoName !== constants.SOCKET_DEFAULT_REPOSITORY) {
    coanaEnv['SOCKET_REPO_NAME'] = repoName
  }
  if (branchName && branchName !== constants.SOCKET_DEFAULT_BRANCH) {
    coanaEnv['SOCKET_BRANCH_NAME'] = branchName
  }

  // Run Coana with the manifests tar hash.
  const coanaResult = await withSpinnerRestore(
    spinner,
    wasSpinning,
    async () => {
      return await spawnCoana(coanaArgs, orgSlug, {
        cwd,
        env: coanaEnv,
        spinner,
        stdio: 'inherit',
      })
    },
  )

  return coanaResult.ok
    ? {
        ok: true,
        data: {
          // Use the DOT_SOCKET_DOT_FACTS_JSON file for the scan.
          reachabilityReport: constants.DOT_SOCKET_DOT_FACTS_JSON,
          tier1ReachabilityScanId: extractTier1ReachabilityScanId(
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          ),
        },
      }
    : coanaResult
}
