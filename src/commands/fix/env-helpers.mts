import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'

import { getSocketFixPrs } from './pull-request.mts'
import constants from '../../constants.mts'
import { getBaseBranch, getRepoInfo } from '../../utils/git.mts'

import type { PrMatch } from './pull-request.mts'
import type { RepoInfo } from '../../utils/git.mts'

function ciRepoInfo(): RepoInfo | undefined {
  const { GITHUB_REPOSITORY } = constants.ENV
  if (!GITHUB_REPOSITORY) {
    debugFn('notice', 'miss: GITHUB_REPOSITORY env var')
  }
  const ownerSlashRepo = GITHUB_REPOSITORY
  const slashIndex = ownerSlashRepo.indexOf('/')
  if (slashIndex === -1) {
    return undefined
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
  repoInfo: RepoInfo | undefined
}

export async function getFixEnv(): Promise<FixEnv> {
  const baseBranch = await getBaseBranch()
  const gitEmail = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL
  const gitUser = constants.ENV.SOCKET_CLI_GIT_USER_NAME
  const githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN
  const isCi = !!(constants.ENV.CI && gitEmail && gitUser && githubToken)

  if (
    // If isCi is false,
    !isCi &&
    // but some CI checks are passing,
    (constants.ENV.CI || gitEmail || gitUser || githubToken) &&
    // then log about it when in debug mode.
    isDebug('notice')
  ) {
    const envVars = [
      ...(constants.ENV.CI ? [] : ['process.env.CI']),
      ...(gitEmail ? [] : ['process.env.SOCKET_CLI_GIT_USER_EMAIL']),
      ...(gitUser ? [] : ['process.env.SOCKET_CLI_GIT_USER_NAME']),
      ...(githubToken ? [] : ['process.env.GITHUB_TOKEN']),
    ]
    debugFn(
      'notice',
      `miss: fixEnv.isCi is false, expected ${joinAnd(envVars)} to be set`,
    )
  }

  let repoInfo: RepoInfo | undefined
  if (isCi) {
    repoInfo = ciRepoInfo()
  }
  if (!repoInfo) {
    if (isCi) {
      debugFn('notice', 'falling back to `git remote get-url origin`')
    }
    repoInfo = await getRepoInfo()
  }

  const prs =
    isCi && repoInfo
      ? await getSocketFixPrs(repoInfo.owner, repoInfo.repo, {
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
