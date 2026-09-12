import { getSocketApiToken } from '@socketsecurity/lib-stable/env/socket'
import { getSocketCliNoApiToken } from '@socketsecurity/lib-stable/env/socket-cli'

import { outputConfigGet } from './output-config-get.mts'
import { CONFIG_KEY_API_TOKEN } from '../../constants/config.mts'
import { getConfigValue } from '../../util/config.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../util/config.mts'

export async function handleConfigGet({
  key,
  outputKind,
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  // An API token supplied via the environment takes precedence over any
  // persisted or --config value. It is no longer mirrored into the in-memory
  // config (so unrelated keys stay persistable via `config set`), so surface it
  // explicitly here to keep "env token wins" for `config get apiToken`.
  const envApiToken = getSocketCliNoApiToken() ? undefined : getSocketApiToken()
  const result: CResult<LocalConfig[keyof LocalConfig]> =
    key === CONFIG_KEY_API_TOKEN && envApiToken
      ? { ok: true, data: envApiToken }
      : getConfigValue(key)

  await outputConfigGet(key, result, outputKind)
}
