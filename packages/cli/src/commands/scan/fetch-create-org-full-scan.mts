import {
  getDefaultApiBaseUrl,
  handleApiCall,
} from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { Spinner } from '@socketsecurity/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchCreateOrgFullScanConfigs = {
  branchName: string
  commitHash: string
  commitMessage: string
  committers: string
  pullRequest: number
  repoName: string
}

export type FetchCreateOrgFullScanOptions = {
  cwd?: string | undefined
  defaultBranch?: boolean | undefined
  pendingHead?: boolean | undefined
  sdkOpts?: SetupSdkOptions | undefined
  spinner?: Spinner | undefined
  tmp?: boolean | undefined
}

export async function fetchCreateOrgFullScan(
  packagePaths: string[],
  orgSlug: string,
  config: FetchCreateOrgFullScanConfigs,
  options?: FetchCreateOrgFullScanOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']>> {
  const {
    branchName,
    commitHash,
    commitMessage,
    committers,
    pullRequest,
    repoName,
  } = { __proto__: null, ...config } as FetchCreateOrgFullScanConfigs

  const {
    cwd = process.cwd(),
    defaultBranch,
    pendingHead,
    sdkOpts,
    spinner,
    tmp,
  } = { __proto__: null, ...options } as FetchCreateOrgFullScanOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const queryParams = {
    ...(branchName ? { branch: branchName } : {}),
    ...(commitHash ? { commit_hash: commitHash } : {}),
    ...(commitMessage ? { commit_message: commitMessage } : {}),
    ...(committers ? { committers } : {}),
    make_default_branch: String(defaultBranch),
    ...(pullRequest ? { pull_request: String(pullRequest) } : {}),
    repo: repoName,
    set_as_pending_head: String(pendingHead),
    tmp: String(tmp),
  }

  const baseUrl = getDefaultApiBaseUrl()
  const endpointPath = `orgs/${encodeURIComponent(orgSlug)}/full-scans`
  const queryString = new URLSearchParams(queryParams as Record<string, string>)
  const requestUrl = `${
    baseUrl ?? ''
  }${baseUrl?.endsWith('/') ? '' : '/'}${endpointPath}${
    queryString.toString() ? `?${queryString.toString()}` : ''
  }`

  return await handleApiCall(
    sockSdk.createFullScan(orgSlug, packagePaths, {
      pathsRelativeTo: cwd,
      queryParams,
    }),
    {
      description: 'to create a scan',
      spinner,
      requestInfo: {
        method: 'POST',
        url: requestUrl,
      },
    },
  )
}
