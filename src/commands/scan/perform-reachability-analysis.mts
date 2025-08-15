import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import {
  extractTier1ReachabilityScanId,
  spawnCoana,
} from '../../utils/coana.mts'
import { convertToCoanaEcosystems } from '../../utils/ecosystem.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type ReachabilityOptions = {
  reachDisableAnalytics: boolean
  reachAnalysisTimeout: number
  reachAnalysisMemoryLimit: number
  reachEcosystems: PURL_Type[]
  reachExcludePaths: string[]
}

export type ReachabilityAnalysisConfig = {
  branchName?: string
  cwd: string
  orgSlug?: string
  packagePaths?: string[]
  reachabilityOptions: ReachabilityOptions
  repoName?: string
  uploadManifests?: boolean
}

export type ReachabilityAnalysisOptions = {
  spinner?: Spinner | undefined
}

export type ReachabilityAnalysisResult = {
  reachabilityReport: string
  tier1ReachabilityScanId: string | undefined
}

export async function performReachabilityAnalysis(
  {
    branchName,
    cwd,
    orgSlug,
    packagePaths,
    reachabilityOptions,
    repoName,
    uploadManifests = true,
  }: ReachabilityAnalysisConfig,
  options?: ReachabilityAnalysisOptions | undefined,
): Promise<CResult<ReachabilityAnalysisResult>> {
  const { spinner } = {
    __proto__: null,
    ...options,
  } as ReachabilityAnalysisOptions

  let tarHash: string | undefined

  if (uploadManifests && orgSlug && packagePaths) {
    // Setup SDK for uploading manifests
    const sockSdkCResult = await setupSdk()
    if (!sockSdkCResult.ok) {
      return sockSdkCResult
    }

    const sockSdk = sockSdkCResult.data

    const wasSpinning = !!spinner?.isSpinning

    // Upload manifests to get tar hash
    spinner?.start('Uploading manifests for reachability analysis...')

    // Exclude DOT_SOCKET_DOT_FACTS_JSON if it was created in previous runs.
    const filteredPackagePaths = packagePaths.filter(
      p => !p.endsWith(constants.DOT_SOCKET_DOT_FACTS_JSON),
    )
    const uploadCResult = await handleApiCall(
      sockSdk.uploadManifestFiles(orgSlug, filteredPackagePaths),
      {
        desc: 'upload manifests',
        spinner,
      },
    )

    spinner?.stop()

    if (!uploadCResult.ok) {
      if (wasSpinning) {
        spinner.start()
      }
      return uploadCResult
    }

    tarHash = (uploadCResult.data as { tarHash?: string })?.tarHash
    if (!tarHash) {
      if (wasSpinning) {
        spinner.start()
      }
      return {
        ok: false,
        message: 'Failed to get manifest tar hash',
        cause: 'Server did not return a tar hash for the uploaded manifests',
      }
    }

    spinner?.start()
    spinner?.success(`Manifests uploaded successfully. Tar hash: ${tarHash}`)
    spinner?.infoAndStop('Running reachability analysis with Coana...')
  } else {
    const wasSpinning = !!spinner?.isSpinning
    spinner?.start('Running reachability analysis with Coana...')
    if (!wasSpinning) {
      spinner?.stop()
    }
  }

  // Build Coana arguments
  const coanaArgs = [
    'run',
    cwd,
    '--output-dir',
    cwd,
    '--socket-mode',
    constants.DOT_SOCKET_DOT_FACTS_JSON,
    '--disable-report-submission',
    ...(reachabilityOptions.reachAnalysisTimeout
      ? [
          '--analysis-timeout',
          reachabilityOptions.reachAnalysisTimeout.toString(),
        ]
      : []),
    ...(reachabilityOptions.reachAnalysisMemoryLimit
      ? [
          '--memory-limit',
          reachabilityOptions.reachAnalysisMemoryLimit.toString(),
        ]
      : []),
    ...(reachabilityOptions.reachDisableAnalytics
      ? ['--disable-analytics-sharing']
      : []),
    // empty reachEcosystems implies scan all ecosystems
    ...(reachabilityOptions.reachEcosystems.length
      ? [
          '--ecosystems',
          ...convertToCoanaEcosystems(reachabilityOptions.reachEcosystems),
        ]
      : []),
    ...(reachabilityOptions.reachExcludePaths.length
      ? ['--exclude-dirs', reachabilityOptions.reachExcludePaths.join(' ')]
      : []),
    ...(tarHash
      ? ['--manifests-tar-hash', tarHash, '--run-without-docker']
      : []),
  ]

  // Build environment variables
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  }
  if (repoName) {
    env['SOCKET_REPO_NAME'] = repoName
  }
  if (branchName) {
    env['SOCKET_BRANCH_NAME'] = branchName
  }

  // Run Coana with the manifests tar hash.
  const coanaResult = await spawnCoana(coanaArgs, {
    cwd,
    env,
    spinner,
    stdio: 'inherit',
  })

  const wasSpinning = !!spinner?.isSpinning
  if (wasSpinning) {
    spinner.start()
  }

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
