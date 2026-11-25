import { readFile } from 'node:fs/promises'

import { envAsString } from '../../utils/env.mts'

export type CiPullRequestContext = {
  baseBranch: string | undefined
  baseCommitHash: string | undefined
  number: number
  provider: 'azure' | 'github' | 'gitlab' | undefined
}

export async function detectCiPullRequestContext(): Promise<CiPullRequestContext> {
  const environment = process.env
  const githubMatch = /^refs\/pull\/(\d+)\//.exec(
    envAsString(environment['GITHUB_REF']),
  )
  if (githubMatch) {
    let baseCommitHash = envAsString(environment['GITHUB_BASE_SHA']) || undefined
    const eventPath = envAsString(environment['GITHUB_EVENT_PATH'])
    if (!baseCommitHash && eventPath) {
      try {
        const event = JSON.parse(await readFile(eventPath, 'utf8'))
        baseCommitHash =
          typeof event?.pull_request?.base?.sha === 'string'
            ? event.pull_request.base.sha
            : undefined
      } catch {
        baseCommitHash = undefined
      }
    }

    return {
      baseBranch: envAsString(environment['GITHUB_BASE_REF']) || undefined,
      baseCommitHash,
      number: Number(githubMatch[1]),
      provider: 'github',
    }
  }

  const gitlabNumber = Number(envAsString(environment['CI_MERGE_REQUEST_IID']))
  if (Number.isSafeInteger(gitlabNumber) && gitlabNumber > 0) {
    return {
      baseBranch:
        envAsString(environment['CI_MERGE_REQUEST_TARGET_BRANCH_NAME']) ||
        undefined,
      baseCommitHash:
        envAsString(environment['CI_MERGE_REQUEST_DIFF_BASE_SHA']) || undefined,
      number: gitlabNumber,
      provider: 'gitlab',
    }
  }

  const azureNumber = Number(
    envAsString(environment['SYSTEM_PULLREQUEST_PULLREQUESTNUMBER']) ||
      envAsString(environment['SYSTEM_PULLREQUEST_PULLREQUESTID']),
  )
  if (Number.isSafeInteger(azureNumber) && azureNumber > 0) {
    return {
      baseBranch:
        envAsString(environment['SYSTEM_PULLREQUEST_TARGETBRANCH']) ||
        undefined,
      baseCommitHash: undefined,
      number: azureNumber,
      provider: 'azure',
    }
  }

  return {
    baseBranch: undefined,
    baseCommitHash: undefined,
    number: 0,
    provider: undefined,
  }
}
