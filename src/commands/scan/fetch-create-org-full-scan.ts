import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

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
    repoName
  }: {
    branchName: string
    commitHash: string
    commitMessage: string
    committers: string
    pullRequest: number
    repoName: string
  }
): Promise<SocketSdkReturnType<'CreateOrgFullScan'>['data'] | undefined> {
  const sockSdk = await setupSdk()

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(
    `Sending request to create a scan with ${packagePaths.length} packages...`
  )

  const result = await handleApiCall(
    sockSdk.createOrgFullScan(
      orgSlug,
      {
        ...(branchName ? { branch: branchName } : {}),
        ...(commitHash ? { commit_hash: commitHash } : {}),
        ...(commitMessage ? { commit_message: commitMessage } : {}),
        ...(committers ? { committers } : {}),
        make_default_branch: String(defaultBranch),
        ...(pullRequest ? { pull_request: String(pullRequest) } : {}),
        repo: repoName || 'socket-default-repository', // mandatory, this is server default for repo
        set_as_pending_head: String(pendingHead),
        tmp: String(tmp)
      },
      packagePaths,
      cwd
    ),
    'Creating scan'
  )

  spinner.successAndStop('Completed request to create a new scan.')

  if (!result.success) {
    handleUnsuccessfulApiResponse('CreateOrgFullScan', result)
  }

  return result.data
}
