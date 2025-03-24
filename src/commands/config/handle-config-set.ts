import { outputConfigSet } from './output-config-set'
import { updateConfigValue } from '../../utils/config'

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

  await outputConfigSet(key, value, outputKind)
}
