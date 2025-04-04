import { outputConfigGet } from './output-config-get'
import { getConfigValue, isReadOnlyConfig } from '../../utils/config'

import type { LocalConfig } from '../../utils/config'

export async function handleConfigGet({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: 'json' | 'markdown' | 'text'
}) {
  const value = getConfigValue(key)
  const readOnly = isReadOnlyConfig()

  await outputConfigGet(key, value, readOnly, outputKind)
}
