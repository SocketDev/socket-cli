import { debug, debugDir } from '@socketsecurity/lib/debug'

import { outputConfigSet } from './output-config-set.mts'
import { updateConfigValue } from '../../utils/config.mts'
import { InputError } from '../../utils/error/errors.mts'

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
    throw new InputError(
      `socket config set ${key} requires a VALUE argument; pass the value as the second positional (e.g. \`socket config set ${key} my-value\`)`,
    )
  }

  debug(`Setting config ${key} = ${value}`)
  debugDir({ key, value, outputKind })

  const result = updateConfigValue(key, value)

  debug(`Config update ${result.ok ? 'succeeded' : 'failed'}`)
  debugDir({ result })

  await outputConfigSet(result, outputKind)
}
