/** @fileoverview Config set business logic handler for Socket CLI. Persists configuration key-value pairs to config file and delegates to output formatter. */

import { outputConfigSet } from './output-config-set.mts'
import { updateConfigValue } from '../../utils/config.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

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
  debugFn('notice', `Setting config ${key} = ${value}`)
  debugDir('inspect', { key, value, outputKind })

  const result = updateConfigValue(key, value)

  debugFn('notice', `Config update ${result.ok ? 'succeeded' : 'failed'}`)
  debugDir('inspect', { result })

  await outputConfigSet(result, outputKind)
}
