import { createScanFromGithub } from './create-scan-from-github.mts'
import { outputScanGithub } from './output-scan-github.mts'

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

  await outputScanGithub(result, outputKind)
}
