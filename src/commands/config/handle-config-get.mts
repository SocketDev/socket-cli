import { outputConfigGet } from './output-config-get.mts'
import constants, { CONFIG_KEY_API_TOKEN } from '../../constants.mts'
import { getConfigValue } from '../../utils/config.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigGet({
  key,
  outputKind,
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  // A Socket API token supplied via the environment (SOCKET_CLI_API_TOKEN /
  // SOCKET_SECURITY_API_TOKEN and legacy aliases, all aggregated into
  // constants.ENV.SOCKET_CLI_API_TOKEN) takes precedence over any persisted or
  // --config value. The env token is no longer mirrored into the in-memory
  // config (so unrelated keys stay persistable via `config set`), so surface it
  // explicitly here to preserve "env token wins" for `config get apiToken`.
  const { ENV } = constants
  const result: CResult<LocalConfig[keyof LocalConfig]> =
    key === CONFIG_KEY_API_TOKEN &&
    !ENV.SOCKET_CLI_NO_API_TOKEN &&
    ENV.SOCKET_CLI_API_TOKEN
      ? { ok: true, data: ENV.SOCKET_CLI_API_TOKEN }
      : getConfigValue(key)

  await outputConfigGet(key, result, outputKind)
}
