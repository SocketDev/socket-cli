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
  const ghScanCResult = await createScanFromGithub({
    all: all,
    githubApiUrl,
    githubToken,
    interactive: interactive,
    orgSlug,
    orgGithub,
    outputKind,
    repos: repos || '',
  })

  await outputScanGithub(ghScanCResult, outputKind)
}
