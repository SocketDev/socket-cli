import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { isOmittedReachValue } from './reachability-units.mts'
import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { extractTier1ReachabilityScanId } from '../../utils/coana.mts'
import { spawnCoanaDlx } from '../../utils/dlx.mts'
import { hasEnterpriseOrgPlan } from '../../utils/organization.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { socketDevLink } from '../../utils/terminal-link.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { ResolvedPathsSidecar } from '../manifest/scripts/sidecar.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { StdioOptions } from 'node:child_process'

export type ReachabilityOptions = {
  excludePaths: string[]
  reachAnalysisMemoryLimit: string
  reachAnalysisTimeout: string
  reachConcurrency: number
  reachContinueOnAnalysisErrors: boolean
  reachContinueOnInstallErrors: boolean
  reachContinueOnMissingLockFiles: boolean
  reachContinueOnNoSourceFiles: boolean
  reachDebug: boolean
  reachDetailedAnalysisLogFile: boolean
  reachDisableExternalToolChecks: boolean
  reachDisableAnalytics: boolean
  reachEcosystems: PURL_Type[]
  reachEnableAnalysisSplitting: boolean
  reachExcludePaths: string[]
  reachLazyMode: boolean
  reachRetainFactsFile: boolean
  reachSkipCache: boolean
  reachUseOnlyPregeneratedSboms: boolean
  reachVersion: string | undefined
}

export type ReachabilityAnalysisOptions = {
  branchName?: string | undefined
  cwd?: string | undefined
  orgSlug?: string | undefined
  outputKind?: OutputKind | undefined
  outputPath?: string | undefined
  packagePaths?: string[] | undefined
  reachabilityOptions: ReachabilityOptions
  // Resolved-paths sidecar from the auto-manifest run; passed to coana so it
  // reuses these paths instead of re-resolving the build.
  resolvedPathsSidecar?: ResolvedPathsSidecar | undefined
  repoName?: string | undefined
  spinner?: Spinner | undefined
  target: string
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
    outputKind = 'text',
    outputPath,
    packagePaths,
    reachabilityOptions,
    repoName,
    resolvedPathsSidecar,
    spinner,
    target,
    uploadManifests = true,
  } = { __proto__: null, ...options } as ReachabilityAnalysisOptions

  // Determine the analysis target - make it relative to cwd if absolute.
  let analysisTarget = target
  if (path.isAbsolute(analysisTarget)) {
    analysisTarget = path.relative(cwd, analysisTarget) || '.'
  }

  // Check if user has enterprise plan for reachability analysis.
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    const httpCode = (orgsCResult.data as { code?: number } | undefined)?.code
    if (httpCode === constants.HTTP_STATUS_UNAUTHORIZED) {
      return {
        ok: false,
        message: 'Authentication failed',
        cause:
          'Your API token appears to be invalid, expired, or revoked. Please check your token and try again.',
      }
    }
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
      message:
        'Full application reachability analysis requires an enterprise plan',
      cause: `Please ${socketDevLink('upgrade your plan', '/pricing')}. This feature is only available for organizations with an enterprise plan.`,
    }
  }

  const wasSpinning = !!spinner?.isSpinning

  let tarHash: string | undefined

  if (uploadManifests && orgSlug && packagePaths) {
    // Setup SDK for uploading manifests
    const sockSdkCResult = await setupSdk()
    if (!sockSdkCResult.ok) {
      return sockSdkCResult
    }

    const sockSdk = sockSdkCResult.data

    spinner?.start('Uploading manifests for reachability analysis...')

    // Ensure uploaded manifest files are relative to analysis target as coana resolves SBOM manifest files relative to this path
    // NOTE: previously stripped any `.socket.facts.json` from packagePaths
    // here to avoid uploading leftover post-reachability output. With the
    // producer flow (`socket manifest gradle --facts`) those files are
    // legitimate INPUT to compute-artifacts, so we now upload them. Stale
    // facts files are cleaned up downstream — see the post-success
    // deletion in handle-create-new-scan.mts.
    const uploadCResult = await handleApiCall(
      sockSdk.uploadManifestFiles(orgSlug, packagePaths, {
        pathsRelativeTo: path.resolve(cwd, analysisTarget),
      }),
      {
        description: 'upload manifests',
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
  }

  spinner?.start()
  spinner?.infoAndStop('Running reachability analysis with Coana...')

  const outputFilePath = outputPath || constants.DOT_SOCKET_DOT_FACTS_JSON

  // Write the sidecar to a temp file for `--compute-artifacts-sidecar`; cleaned
  // up in the finally below.
  let sidecarPath: string | undefined
  if (resolvedPathsSidecar?.length) {
    sidecarPath = path.join(
      tmpdir(),
      `socket-compute-artifacts-sidecar-${randomUUID()}.json`,
    )
    await fs.writeFile(
      sidecarPath,
      JSON.stringify(resolvedPathsSidecar),
      'utf8',
    )
  }

  // Build Coana arguments.
  const coanaArgs = [
    'run',
    analysisTarget,
    '--output-dir',
    path.dirname(outputFilePath),
    '--socket-mode',
    outputFilePath,
    '--disable-report-submission',
    ...(isOmittedReachValue(reachabilityOptions.reachAnalysisTimeout)
      ? []
      : ['--analysis-timeout', reachabilityOptions.reachAnalysisTimeout]),
    ...(isOmittedReachValue(reachabilityOptions.reachAnalysisMemoryLimit)
      ? []
      : ['--memory-limit', reachabilityOptions.reachAnalysisMemoryLimit]),
    ...(reachabilityOptions.reachConcurrency
      ? ['--concurrency', `${reachabilityOptions.reachConcurrency}`]
      : []),
    ...(reachabilityOptions.reachContinueOnAnalysisErrors
      ? ['--reach-continue-on-analysis-errors']
      : []),
    ...(reachabilityOptions.reachContinueOnInstallErrors
      ? ['--reach-continue-on-install-errors']
      : []),
    ...(reachabilityOptions.reachContinueOnMissingLockFiles
      ? ['--reach-continue-on-missing-lock-files']
      : []),
    ...(reachabilityOptions.reachContinueOnNoSourceFiles
      ? ['--reach-continue-on-no-source-files']
      : []),
    ...(reachabilityOptions.reachDebug ? ['--debug'] : []),
    ...(reachabilityOptions.reachDetailedAnalysisLogFile
      ? ['--print-analysis-log-file']
      : []),
    ...(reachabilityOptions.reachDisableAnalytics
      ? ['--disable-analytics-sharing']
      : []),
    ...(reachabilityOptions.reachDisableExternalToolChecks
      ? ['--disable-external-tool-checks']
      : []),
    ...(reachabilityOptions.reachEnableAnalysisSplitting
      ? []
      : ['--disable-analysis-splitting']),
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
    ...(reachabilityOptions.reachLazyMode ? ['--lazy-mode'] : []),
    ...(reachabilityOptions.reachSkipCache ? ['--skip-cache-usage'] : []),
    ...(reachabilityOptions.reachUseOnlyPregeneratedSboms
      ? ['--use-only-pregenerated-sboms']
      : []),
    ...(sidecarPath ? ['--compute-artifacts-sidecar', sidecarPath] : []),
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

  // In machine-readable modes (--json/--markdown) the final payload is written
  // to stdout by the output layer. Coana streams progress/logs over stdout
  // under `inherit`, which would corrupt that payload, so redirect the child's
  // stdout to our stderr (fd 2). Progress stays visible for humans and
  // `2>/dev/null` isolates the JSON/markdown. stdin and stderr stay inherited.
  const coanaStdio: StdioOptions =
    outputKind === 'text' ? 'inherit' : ['inherit', 2, 'inherit']

  try {
    // Run Coana with the manifests tar hash.
    const coanaResult = await spawnCoanaDlx(coanaArgs, orgSlug, {
      coanaVersion: reachabilityOptions.reachVersion,
      cwd,
      env: coanaEnv,
      spinner,
      stdio: coanaStdio,
    })

    if (wasSpinning) {
      spinner.start()
    }

    if (!coanaResult.ok) {
      const coanaVersion =
        reachabilityOptions.reachVersion ||
        constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION
      logger.error(
        `Coana reachability analysis failed. Version: ${coanaVersion}, target: ${analysisTarget}, cwd: ${cwd}`,
      )
      if (coanaResult.message) {
        logger.error(`Details: ${coanaResult.message}`)
      }
      return coanaResult
    }

    // Coana writes the facts file relative to the scan `cwd` (it is spawned
    // with `cwd` above), so resolve the read path against `cwd` too. Reading
    // the bare relative path would resolve against `process.cwd()` and miss
    // the file whenever `cwd !== process.cwd()` (e.g. `--cwd <dir>`), silently
    // dropping the full application reachability scan id and skipping finalize downstream.
    const resolvedReportPath = path.resolve(cwd, outputFilePath)

    return {
      ok: true,
      data: {
        // Use the actual output filename for the scan. Keep this `cwd`-relative
        // so the upload (which relativizes against `cwd`) and the post-success
        // unlink (`path.resolve(cwd, reachabilityReport)`) keep working.
        reachabilityReport: outputFilePath,
        tier1ReachabilityScanId:
          extractTier1ReachabilityScanId(resolvedReportPath),
      },
    }
  } finally {
    // Best-effort cleanup of the temp sidecar.
    if (sidecarPath) {
      try {
        await fs.unlink(sidecarPath)
      } catch {
        // File may already be gone or unwritable.
      }
    }
  }
}
