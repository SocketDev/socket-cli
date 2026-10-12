import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'

import { outputConfigSet } from './output-config-set.mts'
import { REDACTED } from '../../constants/cli.mts'
import { isSensitiveConfigKey, updateConfigValue } from '../../util/config.mts'
import { InputError } from '../../util/error/errors.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../util/config.mts'

export async function handleConfigSet({
  key,
  outputKind,
  value,
}: {
  key: keyof LocalConfig
  value?: string | undefined
  outputKind: OutputKind
}) {
  if (value === undefined) {
    throw new InputError(
      `socket config set ${key} requires a VALUE argument; pass the value as the second positional (e.g. \`socket config set ${key} my-value\`)`,
    )
  }

  const displayedValue = isSensitiveConfigKey(key) ? REDACTED : value
  debug(`Setting config ${key} = ${displayedValue}`)
  debugDir({ key, value: displayedValue, outputKind })

  const result = updateConfigValue(key, value)

  // `config set` is one-shot: an in-memory-only change is a no-op because the
  // process exits before anything reads it. updateConfigValue only fills `data`
  // when the config is read-only (a full --config / SOCKET_CLI_CONFIG /
  // SOCKET_CLI_NO_API_TOKEN override), so report a failure there rather than a
  // misleading `OK`.
  const outcome: CResult<string | undefined> =
    result.ok && result.data
      ? {
          ok: false,
          code: 1,
          message: `Config key '${key}' was not saved`,
          cause: result.data,
        }
      : result

  debug(`Config update ${outcome.ok ? 'succeeded' : 'failed'}`)
  debugDir({ outcome, result })

  await outputConfigSet(outcome, outputKind)
}
