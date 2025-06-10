import { createSocketBranchParser, getBaseGitBranch } from './git.mts'
import { getGithubEnvRepoInfo, getOpenSocketPrs } from './open-pr.mts'
import constants from '../../constants.mts'

import type { SocketBranchParser } from './git.mts'
import type { GithubRepoInfo, PrMatch } from './open-pr.mts'

export interface CiEnv {
  gitEmail: string
  gitUser: string
  githubToken: string
  repoInfo: GithubRepoInfo
  baseBranch: string
  branchParser: SocketBranchParser
}

export function getCiEnv(): CiEnv | null {
  const gitEmail = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL
  const gitUser = constants.ENV.SOCKET_CLI_GIT_USER_NAME
  const githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN
  const isCi = !!(
    constants.ENV.CI &&
    constants.ENV.GITHUB_ACTIONS &&
    constants.ENV.GITHUB_REPOSITORY &&
    gitEmail &&
    gitUser &&
    githubToken
  )
  return isCi
    ? {
        gitEmail,
        gitUser,
        githubToken,
        repoInfo: getGithubEnvRepoInfo()!,
        baseBranch: getBaseGitBranch(),
        branchParser: createSocketBranchParser(),
      }
    : null
}

export async function getOpenPrsForEnvironment(env: CiEnv): Promise<PrMatch[]> {
  return env
    ? await getOpenSocketPrs(env.repoInfo.owner, env.repoInfo.repo, {
        author: env.gitUser,
      })
    : []
}
