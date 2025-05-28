import { outputFixResult } from './output-fix-result.mts'
import { runFix } from './run-fix.mts'

import type { OutputKind } from '../../types.mts'
import type { RangeStyle } from '../../utils/semver.mts'

export async function handleFix({
  autoMerge,
  cwd,
  limit,
  outputKind,
  purls,
  rangeStyle,
  test,
  testScript,
}: {
  autoMerge: boolean
  cwd: string
  limit: number
  outputKind: OutputKind
  purls: string[]
  rangeStyle: RangeStyle
  test: boolean
  testScript: string
}) {
  const result = await runFix({
    autoMerge,
    cwd,
    limit,
    purls,
    rangeStyle,
    test,
    testScript,
  })

  await outputFixResult(result, outputKind)
}
