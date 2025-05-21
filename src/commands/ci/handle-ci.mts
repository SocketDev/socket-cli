import { logger } from '@socketsecurity/registry/lib/logger'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'
import { handleCreateNewScan } from '../scan/handle-create-new-scan.mts'

export async function handleCI(autoManifest: boolean): Promise<void> {
  // ci: {
  //   description: 'Alias for "report create --view --strict"',
  //     argv: ['report', 'create', '--view', '--strict']
  // }
  const result = await getDefaultOrgSlug()
  if (!result.ok) {
    process.exitCode = result.code ?? 1
    // Always assume json mode
    logger.log(serializeResultJson(result))
    return
  }

  // TODO: does it make sense to discover the commit details from local git?
  // TODO: does it makes sense to use custom branch/repo names here? probably socket.yml, right
  await handleCreateNewScan({
    autoManifest,
    branchName: 'socket-default-branch',
    commitMessage: '',
    commitHash: '',
    committers: '',
    cwd: process.cwd(),
    defaultBranch: false,
    interactive: false,
    orgSlug: result.data,
    outputKind: 'json',
    pendingHead: true, // when true, requires branch name set, tmp false
    pullRequest: 0,
    repoName: 'socket-default-repository',
    readOnly: false,
    report: true,
    targets: ['.'],
    tmp: false, // don't set when pendingHead is true
  })
}
