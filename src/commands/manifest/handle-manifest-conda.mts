import { convertCondaToRequirements } from './convert-conda-to-requirements.mts'
import { outputRequirements } from './output-requirements.mts'

import type { OutputKind } from '../../types.mts'

export async function handleManifestConda(
  target: string,
  out: string,
  outputKind: OutputKind,
  cwd: string,
  verbose: boolean,
): Promise<void> {
  const data = await convertCondaToRequirements(target, cwd, verbose)

  await outputRequirements(data, outputKind, out)
}
