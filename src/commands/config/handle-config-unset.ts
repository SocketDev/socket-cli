import { outputConfigUnset } from './output-config-unset'
import { updateConfigValue } from '../../utils/config'

import type { LocalConfig } from '../../utils/config'

export async function handleConfigUnset({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: 'json' | 'markdown' | 'text'
}) {
  updateConfigValue(key, undefined)

  await outputConfigUnset(key, outputKind)
}
