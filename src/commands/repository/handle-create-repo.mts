/** @fileoverview Repository create business logic handler for Socket CLI. Orchestrates repository integration creation and delegates to output formatter with creation results. */

import { fetchCreateRepo } from './fetch-create-repo.mts'
import { outputCreateRepo } from './output-create-repo.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

import type { OutputKind } from '../../types.mts'

export async function handleCreateRepo(
  {
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  }: {
    orgSlug: string
    repoName: string
    description: string
    homepage: string
    defaultBranch: string
    visibility: string
  },
  outputKind: OutputKind,
): Promise<void> {
  debugFn('notice', `Creating repository ${orgSlug}/${repoName}`)
  debugDir('inspect', {
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
    outputKind,
  })

  const data = await fetchCreateRepo({
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
  })

  debugFn('notice', `Repository creation ${data.ok ? 'succeeded' : 'failed'}`)
  debugDir('inspect', { data })

  outputCreateRepo(data, repoName, outputKind)
}
