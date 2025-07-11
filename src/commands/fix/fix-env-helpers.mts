import { debugFn } from '@socketsecurity/registry/lib/debug'

import { getSocketPrs } from './pull-request.mts'
import constants from '../../constants.mts'
import { getBaseGitBranch, gitRepoInfo } from '../../utils/git.mts'

import type { PrMatch } from './pull-request.mts'
import type { RepoInfo } from '../../utils/git.mts'

function ciRepoInfo(): RepoInfo | null {
  // Lazily access constants.ENV.GITHUB_REPOSITORY.
  const { GITHUB_REPOSITORY } = constants.ENV
  if (!GITHUB_REPOSITORY) {
    debugFn('notice', 'miss: GITHUB_REPOSITORY env var')
  }
  const ownerSlashRepo = GITHUB_REPOSITORY
  const slashIndex = ownerSlashRepo.indexOf('/')
  if (slashIndex === -1) {
    return null
  }
  return {
    owner: ownerSlashRepo.slice(0, slashIndex),
    repo: ownerSlashRepo.slice(slashIndex + 1),
  }
}

export interface FixEnv {
  baseBranch: string
  gitEmail: string
  githubToken: string
  gitUser: string
  isCi: boolean
  prs: PrMatch[]
  repoInfo: RepoInfo | null
}

export async function getFixEnv(): Promise<FixEnv> {
  const baseBranch = await getBaseGitBranch()
  const gitEmail = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL
  const gitUser = constants.ENV.SOCKET_CLI_GIT_USER_NAME
  const githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN
  const isCi = !!(constants.ENV.CI && gitEmail && gitUser && githubToken)
  let repoInfo: RepoInfo | null = null
  if (isCi) {
    repoInfo = ciRepoInfo()
  }
  if (!repoInfo) {
    if (isCi) {
      debugFn('notice', 'falling back to `git remote get-url origin`')
    }
    repoInfo = await gitRepoInfo()
  }
  const prs =
    isCi && repoInfo
      ? await getSocketPrs(repoInfo.owner, repoInfo.repo, {
          author: gitUser,
          states: 'all',
        })
      : []
  return {
    baseBranch,
    gitEmail,
    githubToken,
    gitUser,
    isCi,
    prs,
    repoInfo,
  }
}
