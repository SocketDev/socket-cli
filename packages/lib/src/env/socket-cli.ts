/**
 * @fileoverview Socket CLI environment variables.
 * Provides typed getters for SOCKET_CLI_* environment variables (excluding shadow).
 */

import { envAsBoolean, envAsNumber } from '#env/helpers'
import { getEnvValue } from '#env/rewire'

/**
 * Whether to accept all Socket CLI risks (alternative name).
 *
 * @returns Whether to accept all risks
 */
export function getSocketCliAcceptRisks(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_ACCEPT_RISKS'))
}

/**
 * Socket CLI API base URL (alternative name).
 * Checks SOCKET_CLI_API_BASE_URL first, then falls back to legacy SOCKET_SECURITY_API_BASE_URL.
 *
 * @returns API base URL or undefined
 */
export function getSocketCliApiBaseUrl(): string | undefined {
  return (
    getEnvValue('SOCKET_CLI_API_BASE_URL') ||
    getEnvValue('SOCKET_SECURITY_API_BASE_URL')
  )
}

/**
 * Proxy URL for Socket CLI API requests (alternative name).
 * Checks SOCKET_CLI_API_PROXY, SOCKET_SECURITY_API_PROXY, then standard proxy env vars.
 * Follows the same precedence as v1.x: HTTPS_PROXY → https_proxy → HTTP_PROXY → http_proxy.
 *
 * @returns API proxy URL or undefined
 */
export function getSocketCliApiProxy(): string | undefined {
  return (
    getEnvValue('SOCKET_CLI_API_PROXY') ||
    getEnvValue('SOCKET_SECURITY_API_PROXY') ||
    getEnvValue('HTTPS_PROXY') ||
    getEnvValue('https_proxy') ||
    getEnvValue('HTTP_PROXY') ||
    getEnvValue('http_proxy')
  )
}

/**
 * Timeout in milliseconds for Socket CLI API requests (alternative name).
 *
 * @returns API timeout in milliseconds
 */
export function getSocketCliApiTimeout(): number {
  return envAsNumber(getEnvValue('SOCKET_CLI_API_TIMEOUT'))
}

/**
 * Socket CLI API authentication token (alternative name).
 * Checks SOCKET_CLI_API_TOKEN, SOCKET_CLI_API_KEY, SOCKET_SECURITY_API_TOKEN, SOCKET_SECURITY_API_KEY.
 * Maintains full v1.x backward compatibility.
 *
 * @returns API token or undefined
 */
export function getSocketCliApiToken(): string | undefined {
  return (
    getEnvValue('SOCKET_CLI_API_TOKEN') ||
    getEnvValue('SOCKET_CLI_API_KEY') ||
    getEnvValue('SOCKET_SECURITY_API_TOKEN') ||
    getEnvValue('SOCKET_SECURITY_API_KEY')
  )
}

/**
 * Socket CLI configuration file path (alternative name).
 *
 * @returns Config file path or undefined
 */
export function getSocketCliConfig(): string | undefined {
  return getEnvValue('SOCKET_CLI_CONFIG')
}

/**
 * Controls Socket CLI fix mode.
 *
 * @returns Fix mode value or undefined
 */
export function getSocketCliFix(): string | undefined {
  return getEnvValue('SOCKET_CLI_FIX')
}

/**
 * Whether to skip Socket CLI API token requirement (alternative name).
 *
 * @returns Whether to skip API token requirement
 */
export function getSocketCliNoApiToken(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_NO_API_TOKEN'))
}

/**
 * Controls Socket CLI optimization mode.
 *
 * @returns Whether optimization mode is enabled
 */
export function getSocketCliOptimize(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_OPTIMIZE'))
}

/**
 * Socket CLI organization slug identifier (alternative name).
 * Checks SOCKET_CLI_ORG_SLUG first, then falls back to SOCKET_ORG_SLUG.
 *
 * @returns Organization slug or undefined
 */
export function getSocketCliOrgSlug(): string | undefined {
  return getEnvValue('SOCKET_CLI_ORG_SLUG') || getEnvValue('SOCKET_ORG_SLUG')
}

/**
 * Whether to view all Socket CLI risks (alternative name).
 *
 * @returns Whether to view all risks
 */
export function getSocketCliViewAllRisks(): boolean {
  return envAsBoolean(getEnvValue('SOCKET_CLI_VIEW_ALL_RISKS'))
}

/**
 * Socket CLI GitHub authentication token.
 * Checks SOCKET_CLI_GITHUB_TOKEN, SOCKET_SECURITY_GITHUB_PAT, then falls back to GITHUB_TOKEN.
 *
 * @returns GitHub token or undefined
 */
export function getSocketCliGithubToken(): string | undefined {
  return (
    getEnvValue('SOCKET_CLI_GITHUB_TOKEN') ||
    getEnvValue('SOCKET_SECURITY_GITHUB_PAT') ||
    getEnvValue('GITHUB_TOKEN')
  )
}

/**
 * Bootstrap package spec (e.g., @socketsecurity/cli@^2.0.11).
 * Set by bootstrap wrappers (SEA/smol/npm) to pass package spec to CLI.
 *
 * @returns Bootstrap package spec or undefined
 */
export function getSocketCliBootstrapSpec(): string | undefined {
  return getEnvValue('SOCKET_CLI_BOOTSTRAP_SPEC')
}

/**
 * Bootstrap cache directory path.
 * Set by bootstrap wrappers to pass dlx cache location to CLI.
 *
 * @returns Bootstrap cache directory or undefined
 */
export function getSocketCliBootstrapCacheDir(): string | undefined {
  return getEnvValue('SOCKET_CLI_BOOTSTRAP_CACHE_DIR')
}
