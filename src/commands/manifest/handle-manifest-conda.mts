import path from 'node:path'

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

  // --auto-manifest only collects the generated file when it lands inside
  // the dir being scanned.
  await outputRequirements(
    data,
    outputKind,
    out === '-' ? out : path.resolve(cwd, out),
  )
}
