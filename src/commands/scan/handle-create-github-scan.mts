import { logger } from '@socketsecurity/registry/lib/logger'

import { createScanFromGithub } from './create-scan-from-github.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { OutputKind } from '../../types.mts'

export async function handleCreateGithubScan({
  all,
  githubApiUrl,
  githubToken,
  interactive,
  orgGithub,
  orgSlug,
  outputKind,
  repos,
}: {
  all: boolean
  githubApiUrl: string
  githubToken: string
  interactive: boolean
  orgSlug: string
  orgGithub: string
  outputKind: OutputKind
  repos: string
}) {
  const result = await createScanFromGithub({
    all: Boolean(all),
    githubApiUrl,
    githubToken,
    interactive: Boolean(interactive),
    orgSlug,
    orgGithub,
    outputKind,
    repos: String(repos || ''),
  })

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.success('Ok! Finished!')
}
