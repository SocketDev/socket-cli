import type { OutputKind } from '../../types.mts'
import { convertCondaToRequirements } from './convert-conda-to-requirements.mts'
import { outputRequirements } from './output-requirements.mts'

export async function handleManifestConda({
  cwd,
  filename,
  out,
  outputKind,
  verbose,
}: {
  cwd: string
  filename: string
  out: string
  outputKind: OutputKind
  verbose: boolean
}): Promise<void> {
  const data = await convertCondaToRequirements(filename, cwd, verbose)

  await outputRequirements(data, outputKind, out)
}
