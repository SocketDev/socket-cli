import { readFile } from 'node:fs/promises'

import { envAsString } from '../../utils/env.mts'

export type CiPullRequestContext = {
  baseBranch: string | undefined
  baseCommitHash: string | undefined
  number: number
  provider: 'github' | undefined
}

export async function detectCiPullRequestContext(): Promise<CiPullRequestContext> {
  const match = /^refs\/pull\/(\d+)\//.exec(
    envAsString(process.env['GITHUB_REF']),
  )
  if (!match) {
    return {
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 0,
      provider: undefined,
    }
  }

  let baseCommitHash = envAsString(process.env['GITHUB_BASE_SHA']) || undefined
  const eventPath = envAsString(process.env['GITHUB_EVENT_PATH'])
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
    baseBranch: envAsString(process.env['GITHUB_BASE_REF']) || undefined,
    baseCommitHash,
    number: Number(match[1]),
    provider: 'github',
  }
}
