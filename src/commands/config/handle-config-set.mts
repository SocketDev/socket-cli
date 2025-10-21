import { debug, debugDir } from '@socketsecurity/lib/debug'
import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'
import { updateConfigValue } from '../../utils/config.mts'
import { outputConfigSet } from './output-config-set.mts'

export async function handleConfigSet({
  key,
  outputKind,
  value,
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
  value: string
}) {
  debug(`Setting config ${key} = ${value}`)
  debugDir({ key, value, outputKind })

  const result = updateConfigValue(key, value)

  debug(`Config update ${result.ok ? 'succeeded' : 'failed'}`)
  debugDir({ result })

  await outputConfigSet(result, outputKind)
}
