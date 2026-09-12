import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOCKET_JSON } from '../../constants/socket.mts'

const logger = getDefaultLogger()

export function resolveManifestDefault<T extends boolean | number | string>(
  explicitValue: T | undefined,
  configuredValue: T | undefined,
  fallback: T,
  flagName: string,
): T {
  if (explicitValue !== undefined) {
    return explicitValue
  }
  if (configuredValue !== undefined) {
    logger.info(
      `Using default --${flagName} from ${SOCKET_JSON}:`,
      configuredValue,
    )
    return configuredValue
  }
  return fallback
}
