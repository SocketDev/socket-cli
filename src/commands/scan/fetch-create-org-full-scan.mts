import { handleApiCall } from '../../utils/api.mts'
import { getRepoName } from '../../utils/git.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchCreateOrgFullScan(
  packagePaths: string[],
  orgSlug: string,
  defaultBranch: boolean,
  pendingHead: boolean,
  tmp: boolean,
  cwd: string,
  {
    branchName,
    commitHash,
    commitMessage,
    committers,
    pullRequest,
    repoName,
  }: {
    branchName: string
    commitHash: string
    commitMessage: string
    committers: string
    pullRequest: number
    repoName: string
  },
): Promise<CResult<SocketSdkReturnType<'CreateOrgFullScan'>['data']>> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  return await handleApiCall(
    sockSdk.createOrgFullScan(
      orgSlug,
      {
        ...(branchName ? { branch: branchName } : {}),
        ...(commitHash ? { commit_hash: commitHash } : {}),
        ...(commitMessage ? { commit_message: commitMessage } : {}),
        ...(committers ? { committers } : {}),
        make_default_branch: String(defaultBranch),
        ...(pullRequest ? { pull_request: String(pullRequest) } : {}),
        // The repo is mandatory, this is server default for repo.
        repo:
          repoName || (await getRepoName(cwd)) || 'socket-default-repository',
        set_as_pending_head: String(pendingHead),
        tmp: String(tmp),
      },
      packagePaths,
      cwd,
    ),
    'to create a scan',
  )
}
