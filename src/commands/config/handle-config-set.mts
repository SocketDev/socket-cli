import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

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
  outputKind: OutputKind
  value: string
}) {
  debugFn(`Setting config ${key} = ${value}`)
  debugDir({ key, value, outputKind })

  const result = updateConfigValue(key, value)

  debugFn(`Config update ${result.ok ? 'succeeded' : 'failed'}`)
  debugDir({ result })

  await outputConfigSet(result, outputKind)
}
