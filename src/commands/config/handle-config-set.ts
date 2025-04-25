import { outputConfigSet } from './output-config-set'
import { updateConfigValue } from '../../utils/config'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function handleConfigSet({
  key,
  outputKind,
  value
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
  value: string
}) {
  const result = updateConfigValue(key, value)

  await outputConfigSet(result, outputKind)
}
