import { debugFn } from '@socketsecurity/registry/lib/debug'

import { getBaseGitBranch, gitRepoInfo } from './git.mts'
import { getSocketPrs } from './pull-request.mts'
import constants from '../../constants.mts'

import type { RepoInfo } from './git.mts'
import type { PrMatch } from './pull-request.mts'

async function getEnvRepoInfo(
  cwd?: string | undefined,
): Promise<RepoInfo | null> {
  // Lazily access constants.ENV.GITHUB_REPOSITORY.
  const { GITHUB_REPOSITORY } = constants.ENV
  if (!GITHUB_REPOSITORY) {
    debugFn('notice', 'miss: GITHUB_REPOSITORY env var')
  }
  const ownerSlashRepo = GITHUB_REPOSITORY
  const slashIndex = ownerSlashRepo.indexOf('/')
  if (slashIndex !== -1) {
    return {
      owner: ownerSlashRepo.slice(0, slashIndex),
      repo: ownerSlashRepo.slice(slashIndex + 1),
    }
  }
  debugFn('notice', 'falling back to `git remote get-url origin`')
  return await gitRepoInfo(cwd)
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
  const repoInfo = await getEnvRepoInfo()
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
