import { debugFn } from '@socketsecurity/registry/lib/debug'

import {
  createSocketBranchParser,
  getBaseGitBranch,
  gitRepoInfo,
} from './git.mts'
import { getOpenSocketPrs } from './open-pr.mts'
import constants from '../../constants.mts'

import type { RepoInfo, SocketBranchParser } from './git.mts'
import type { PrMatch } from './open-pr.mts'

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
  return await gitRepoInfo(cwd)
}

export interface CiEnv {
  gitEmail: string
  gitUser: string
  githubToken: string
  repoInfo: RepoInfo
  baseBranch: string
  branchParser: SocketBranchParser
}

export async function getCiEnv(): Promise<CiEnv | null> {
  const gitEmail = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL
  const gitUser = constants.ENV.SOCKET_CLI_GIT_USER_NAME
  const githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN
  const isCi = !!(constants.ENV.CI && gitEmail && gitUser && githubToken)
  if (!isCi) {
    return null
  }
  const baseBranch = await getBaseGitBranch()
  if (!baseBranch) {
    return null
  }
  const repoInfo = await getEnvRepoInfo()
  if (!repoInfo) {
    return null
  }
  return {
    gitEmail,
    gitUser,
    githubToken,
    repoInfo,
    baseBranch,
    branchParser: createSocketBranchParser(),
  }
}

export async function getOpenPrsForEnvironment(
  env: CiEnv | null | undefined,
): Promise<PrMatch[]> {
  return env
    ? await getOpenSocketPrs(env.repoInfo.owner, env.repoInfo.repo, {
        author: env.gitUser,
      })
    : []
}
