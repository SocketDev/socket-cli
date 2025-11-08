import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
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
    tmp,
  } = { __proto__: null, ...options } as FetchCreateOrgFullScanOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  if (constants.ENV.SOCKET_CLI_DEBUG) {
    const fileInfo = await Promise.all(
      packagePaths.map(async p => {
        const absPath = path.resolve(process.cwd(), p)
        const stat = await fs.promises.stat(absPath)
        return { path: absPath, size: stat.size }
      }),
    )
    logger.info(
      `[DEBUG] ${new Date().toISOString()} Uploading full scan manifests: ${JSON.stringify(fileInfo)}`,
    )
  }

  return await handleApiCall(
    sockSdk.createOrgFullScan(orgSlug, packagePaths, cwd, {
      ...(branchName ? { branch: branchName } : {}),
      ...(commitHash ? { commit_hash: commitHash } : {}),
      ...(commitMessage ? { commit_message: commitMessage } : {}),
      ...(committers ? { committers } : {}),
      make_default_branch: String(defaultBranch),
      ...(pullRequest ? { pull_request: String(pullRequest) } : {}),
      repo: repoName,
      set_as_pending_head: String(pendingHead),
      tmp: String(tmp),
    }),
    { description: 'to create a scan' },
  )
}
