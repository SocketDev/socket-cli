/** @fileoverview Manifest Conda business logic handler for Socket CLI. Orchestrates Conda environment.yml conversion to requirements.txt and delegates to output formatter with conversion results. */

import { convertCondaToRequirements } from './convert-conda-to-requirements.mts'
import { outputRequirements } from './output-requirements.mts'

import type { OutputKind } from '../../types.mts'

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
