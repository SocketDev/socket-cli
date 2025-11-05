/**
 * @fileoverview Socket CLI shadow mode environment variables.
 * Provides typed getters for SOCKET_CLI_SHADOW_* environment variables.
 */

import { envAsBoolean } from '#env/helpers'
import { getEnvValue } from '#env/rewire'

/**
 * Controls Socket CLI shadow mode risk acceptance.
 *
 * @returns Whether to accept all risks in shadow mode
 */
export function getSocketCliShadowAcceptRisks(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_SHADOW_ACCEPT_RISKS'))
}

/**
 * API token for Socket CLI shadow mode.
 *
 * @returns Shadow mode API token or undefined
 */
export function getSocketCliShadowApiToken(): string | undefined {
  return getEnvValue('SOCKET_CLI_SHADOW_API_TOKEN')
}

/**
 * Binary path for Socket CLI shadow mode.
 *
 * @returns Shadow mode binary path or undefined
 */
export function getSocketCliShadowBin(): string | undefined {
  return getEnvValue('SOCKET_CLI_SHADOW_BIN')
}

/**
 * Controls Socket CLI shadow mode progress display.
 *
 * @returns Whether to show progress in shadow mode
 */
export function getSocketCliShadowProgress(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_SHADOW_PROGRESS'))
}

/**
 * Controls Socket CLI shadow mode silent operation.
 *
 * @returns Whether shadow mode should operate silently
 */
export function getSocketCliShadowSilent(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_SHADOW_SILENT'))
}
