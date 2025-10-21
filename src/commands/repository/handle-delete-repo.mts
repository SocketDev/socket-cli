import type { OutputKind } from '../../types.mts'
import { fetchDeleteRepo } from './fetch-delete-repo.mts'
import { outputDeleteRepo } from './output-delete-repo.mts'

export async function handleDeleteRepo(
  orgSlug: string,
  repoName: string,
  outputKind: OutputKind,
) {
  const data = await fetchDeleteRepo(orgSlug, repoName)

  await outputDeleteRepo(data, repoName, outputKind)
}
