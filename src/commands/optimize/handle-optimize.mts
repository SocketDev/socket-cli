import { applyOptimization } from './apply-optimization.mts'
import { outputOptimizeResult } from './output-optimize-result.mts'

import type { OutputKind } from '../../types.mts'

export async function handleOptimize({
  cwd,
  outputKind,
  pin,
  prod,
}: {
  cwd: string
  outputKind: OutputKind
  pin: boolean
  prod: boolean
}) {
  const result = await applyOptimization(cwd, pin, prod)

  await outputOptimizeResult(result, outputKind)
}
