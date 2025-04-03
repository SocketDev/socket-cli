import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchCreateOrgFullScan(
  packagePaths: string[],
  orgSlug: string,
  repoName: string,
  branchName: string,
  commitMessage: string,
  defaultBranch: boolean,
  pendingHead: boolean,
  tmp: boolean,
  cwd: string
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
        repo: repoName,
        branch: branchName,
        commit_message: commitMessage,
        make_default_branch: String(defaultBranch),
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
