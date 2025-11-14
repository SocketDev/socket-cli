import { debug, debugDir } from '@socketsecurity/lib/debug'

import { fetchCreateRepo } from './fetch-create-repo.mts'
import { outputCreateRepo } from './output-create-repo.mts'

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
  debug(`Creating repository ${orgSlug}/${repoName}`)
  debugDir({
    defaultBranch,
    description,
    homepage,
    orgSlug,
    repoName,
    visibility,
    outputKind,
  })

  const data = await fetchCreateRepo(
    {
      defaultBranch,
      description,
      homepage,
      orgSlug,
      repoName,
      visibility,
    },
    {
      commandPath: 'socket repository create',
    },
  )

  debug(`Repository creation ${data.ok ? 'succeeded' : 'failed'}`)
  debugDir({ data })

  outputCreateRepo(data, repoName, outputKind)
}
