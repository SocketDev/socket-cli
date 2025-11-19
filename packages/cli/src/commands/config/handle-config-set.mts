import { debug, debugDir } from '@socketsecurity/lib/debug'

import { outputConfigSet } from './output-config-set.mts'
import { updateConfigValue } from '../../utils/config.mts'

import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigSet({
  key,
  outputKind,
  value,
}: {
  key: keyof LocalConfig
  value?: string
  outputKind: OutputKind
}) {
  if (value === undefined) {
    throw new Error('Value is required for config set')
  }

  debug(`Setting config ${key} = ${value}`)
  debugDir({ key, value, outputKind })

  const result = updateConfigValue(key, value)

  debug(`Config update ${result.ok ? 'succeeded' : 'failed'}`)
  debugDir({ result })

  await outputConfigSet(result, outputKind)
}
