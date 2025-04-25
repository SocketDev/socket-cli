import { logger } from '@socketsecurity/registry/lib/logger'

import { convertCondaToRequirements } from './convert-conda-to-requirements'
import { outputRequirements } from './output-requirements'

import type { OutputKind } from '../../types'

export async function handleManifestConda(
  target: string,
  out: string,
  outputKind: OutputKind,
  cwd: string,
  verbose: boolean
): Promise<void> {
  const data = await convertCondaToRequirements(target, cwd, verbose)
  if (!data) {
    return
  }
  if (!data.ok) {
    logger.fail(data.message)
    return
  }

  await outputRequirements(data.data, outputKind, out)
}
