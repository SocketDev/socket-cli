import { outputConfigSet } from './output-config-set'
import { isReadOnlyConfig, updateConfigValue } from '../../utils/config'

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
  updateConfigValue(key, value)
  const readOnly = isReadOnlyConfig()

  await outputConfigSet(key, value, readOnly, outputKind)
}
