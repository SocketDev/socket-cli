import { logger } from '@socketsecurity/registry/lib/logger'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import constants from '../../constants.mts'
import { getRepoName, gitBranch } from '../../utils/git.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'
import { handleCreateNewScan } from '../scan/handle-create-new-scan.mts'

const { SOCKET_DEFAULT_BRANCH, SOCKET_DEFAULT_REPOSITORY } = constants

export async function handleCI(autoManifest: boolean): Promise<void> {
  // ci: {
  //   description: 'Alias for "report create --view --strict"',
  //     argv: ['report', 'create', '--view', '--strict']
  // }
  const result = await getDefaultOrgSlug()
  if (!result.ok) {
    process.exitCode = result.code ?? 1
    // Always assume json mode.
    logger.log(serializeResultJson(result))
    return
  }

  const cwd = process.cwd()

  // TODO: does it makes sense to use custom branch/repo names here? probably socket.yml, right
  await handleCreateNewScan({
    autoManifest,
    branchName: (await gitBranch(cwd)) || SOCKET_DEFAULT_BRANCH,
    commitMessage: '',
    commitHash: '',
    committers: '',
    cwd: process.cwd(),
    defaultBranch: false,
    interactive: false,
    orgSlug: result.data,
    outputKind: 'json',
    // When 'pendingHead' is true, it requires 'branchName' set and 'tmp' false.
    pendingHead: true,
    pullRequest: 0,
    repoName: (await getRepoName(cwd)) || SOCKET_DEFAULT_REPOSITORY,
    readOnly: false,
    report: true,
    targets: ['.'],
    // Don't set 'tmp' when 'pendingHead' is true.
    tmp: false,
  })
}
