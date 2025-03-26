import { outputConfigGet } from './output-config-get'
import { getConfigValue } from '../../utils/config'

import type { LocalConfig } from '../../utils/config'

export async function handleConfigGet({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: 'json' | 'markdown' | 'text'
}) {
  const value = getConfigValue(key)

  await outputConfigGet(key, value, outputKind)
}
