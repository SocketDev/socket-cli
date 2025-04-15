import { getDefaultOrgSlug } from './fetch-default-org-slug'
import { handleCreateNewScan } from '../scan/handle-create-new-scan'

export async function handleCI(): Promise<void> {
  // ci: {
  //   description: 'Alias for "report create --view --strict"',
  //     argv: ['report', 'create', '--view', '--strict']
  // }
  const orgSlug = await getDefaultOrgSlug()
  if (!orgSlug) {
    return
  }

  // TODO: does it make sense to discover the commit details from local git?
  // TODO: does it makes sense to use custom branch/repo names here? probably socket.yml, right
  await handleCreateNewScan({
    branchName: 'socket-default-branch',
    commitMessage: '',
    commitHash: '',
    committers: '',
    cwd: process.cwd(),
    defaultBranch: false,
    interactive: false,
    orgSlug,
    outputKind: 'json',
    pendingHead: true, // when true, requires branch name set, tmp false
    pullRequest: 0,
    repoName: 'socket-default-repository',
    readOnly: false,
    report: true,
    targets: ['.'],
    tmp: false // don't set when pendingHead is true
  })
}
