/**
 * @file Timeout selection for direct Socket API requests.
 */

import { getSocketCliApiTimeout } from '@socketsecurity/lib-stable/env/socket-cli'

export function getSocketApiRequestTimeout(
  defaultTimeout: number | undefined,
  timeoutOverride?: number | undefined,
): number | undefined {
  return resolveSocketApiTimeout(
    getSocketCliApiTimeout(),
    defaultTimeout,
    timeoutOverride,
  )
}

export function resolveSocketApiTimeout(
  configuredTimeout: unknown,
  defaultTimeout: number | undefined,
  timeoutOverride?: number | undefined,
): number | undefined {
  if (timeoutOverride !== undefined) {
    return timeoutOverride
  }
  if (
    typeof configuredTimeout === 'number' &&
    Number.isFinite(configuredTimeout) &&
    configuredTimeout > 0
  ) {
    return configuredTimeout
  }
  return defaultTimeout
}
