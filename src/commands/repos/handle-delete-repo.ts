import { fetchDeleteRepo } from './fetch-delete-repo'
import { outputDeleteRepo } from './output-delete-repo'

import type { OutputKind } from '../../types'

export async function handleDeleteRepo(
  orgSlug: string,
  repoName: string,
  outputKind: OutputKind
) {
  const data = await fetchDeleteRepo(orgSlug, repoName)

  await outputDeleteRepo(data, outputKind)
}
