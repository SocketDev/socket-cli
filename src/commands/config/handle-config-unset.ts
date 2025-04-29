import { outputConfigUnset } from './output-config-unset'
import { updateConfigValue } from '../../utils/config'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function handleConfigUnset({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const updateResult = updateConfigValue(key, undefined)

  await outputConfigUnset(updateResult, outputKind)
}
