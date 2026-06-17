import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { outputConfigSet } from './output-config-set.mts'
import { updateConfigValue } from '../../utils/config.mts'

import type { CResult, OutputKind } from '../../types.mts'
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

  // `config set` is a one-shot command: an in-memory-only change is a no-op
  // because the process exits before anything reads it. updateConfigValue only
  // populates `data` when the config is read-only (a full --config /
  // SOCKET_CLI_CONFIG / SOCKET_CLI_NO_API_TOKEN override), so in that case
  // report a failure instead of a misleading success.
  const outcome: CResult<undefined | string> =
    result.ok && result.data
      ? {
          ok: false,
          code: 1,
          message: `Config key '${key}' was not saved`,
          cause: result.data,
        }
      : result

  debugFn('notice', `Config update ${outcome.ok ? 'succeeded' : 'failed'}`)
  debugDir('inspect', { outcome, result })

  await outputConfigSet(outcome, outputKind)
}
