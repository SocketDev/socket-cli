import { outputConfigSet } from './output-config-set'
import { isReadOnlyConfig, updateConfigValue } from '../../utils/config'

import type { LocalConfig } from '../../utils/config'

export async function handleConfigSet({
  key,
  outputKind,
  value
}: {
  key: keyof LocalConfig
  outputKind: 'json' | 'markdown' | 'text'
  value: string
}) {
  updateConfigValue(key, value)
  const readOnly = isReadOnlyConfig()

  await outputConfigSet(key, value, readOnly, outputKind)
}
