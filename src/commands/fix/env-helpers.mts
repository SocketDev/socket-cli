import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { debug, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getSocketFixPrs } from './pull-request.mts'
import constants from '../../constants.mts'
import { getBaseBranch, getRepoInfo } from '../../utils/git.mts'

import type { PrMatch } from './pull-request.mts'
import type { RepoInfo } from '../../utils/git.mts'

function ciRepoInfo(): RepoInfo | undefined {
  const { GITHUB_REPOSITORY } = constants.ENV
  if (!GITHUB_REPOSITORY) {
    debug('miss: GITHUB_REPOSITORY env var')
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

export interface MissingEnvVars {
  missing: string[]
  present: string[]
}

/**
 * Get formatted instructions for setting CI environment variables.
 */
export function getCiEnvInstructions(): string {
  return (
    'To enable automatic pull request creation, run in CI with these environment variables:\n' +
    '  - CI=1\n' +
    '  - SOCKET_CLI_GITHUB_TOKEN=<your-github-token>\n' +
    '  - SOCKET_CLI_GIT_USER_NAME=<git-username>\n' +
    '  - SOCKET_CLI_GIT_USER_EMAIL=<git-email>'
  )
}

/**
 * Check which required CI environment variables are missing.
 * Returns lists of missing and present variables.
 */
export function checkCiEnvVars(): MissingEnvVars {
  const {
    CI,
    SOCKET_CLI_GIT_USER_EMAIL,
    SOCKET_CLI_GIT_USER_NAME,
    SOCKET_CLI_GITHUB_TOKEN,
  } = constants.ENV

  const missing: string[] = []
  const present: string[] = []

  if (CI) {
    present.push('CI')
  } else {
    missing.push('CI')
  }

  if (SOCKET_CLI_GIT_USER_EMAIL) {
    present.push('SOCKET_CLI_GIT_USER_EMAIL')
  } else {
    missing.push('SOCKET_CLI_GIT_USER_EMAIL')
  }

  if (SOCKET_CLI_GIT_USER_NAME) {
    present.push('SOCKET_CLI_GIT_USER_NAME')
  } else {
    missing.push('SOCKET_CLI_GIT_USER_NAME')
  }

  if (SOCKET_CLI_GITHUB_TOKEN) {
    present.push('SOCKET_CLI_GITHUB_TOKEN')
  } else {
    missing.push('SOCKET_CLI_GITHUB_TOKEN (or GITHUB_TOKEN)')
  }

  return { missing, present }
}

export async function getFixEnv(): Promise<FixEnv> {
  const baseBranch = await getBaseBranch()
  const gitEmail = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL
  const gitUser = constants.ENV.SOCKET_CLI_GIT_USER_NAME
  const githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN
  const isCi = !!(constants.ENV.CI && gitEmail && gitUser && githubToken)

  const envCheck = checkCiEnvVars()

  // Provide clear feedback about missing environment variables.
  if (constants.ENV.CI && envCheck.missing.length > 1) {
    // CI is set but other required vars are missing.
    const missingExceptCi = envCheck.missing.filter(v => v !== 'CI')
    if (missingExceptCi.length) {
      logger.warn(
        `CI mode detected, but pull request creation is disabled due to missing environment variables:\n` +
          `  Missing: ${joinAnd(missingExceptCi)}\n` +
          `  Set these variables to enable automatic pull request creation.`,
      )
    }
  } else if (
    // If not in CI but some CI-related env vars are set.
    !constants.ENV.CI &&
    envCheck.present.length &&
    // then log about it when in debug mode.
    isDebug()
  ) {
    debug(
      `miss: fixEnv.isCi is false, expected ${joinAnd(envCheck.missing)} to be set`,
    )
  }

  let repoInfo: RepoInfo | undefined
  if (isCi) {
    repoInfo = ciRepoInfo()
  }
  if (!repoInfo) {
    if (isCi) {
      debug('falling back to `git remote get-url origin`')
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
