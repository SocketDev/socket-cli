/**
 * Environment variable configuration using proxy/getters to reference registry ENV.
 * This avoids circular dependencies while maintaining access to environment variables.
 */

import ENV_REGISTRY from '@socketsecurity/registry/constants/env'

// Extract the ENV object from registry constants.
const registryEnv = ENV_REGISTRY

// Define CLI-specific environment variables interface.
export interface CliEnvVariables {
  // API configuration.
  SOCKET_API_BASE_URL?: string
  SOCKET_API_TOKEN?: string
  SOCKET_CLI_API_BASE_URL?: string
  SOCKET_CLI_API_PROXY?: string
  SOCKET_CLI_API_TIMEOUT?: string
  SOCKET_CLI_API_TOKEN?: string
  SOCKET_CLI_DEBUG?: string
  SOCKET_CLI_NO_API_TOKEN?: string
  SOCKET_REGISTRY_URL?: string

  // Build metadata.
  INLINED_SOCKET_CLI_CDXGEN_VERSION?: string
  INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION?: string
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION?: string
  INLINED_SOCKET_CLI_HOMEPAGE?: string
  INLINED_SOCKET_CLI_LEGACY_BUILD?: string
  INLINED_SOCKET_CLI_NAME?: string
  INLINED_SOCKET_CLI_PUBLISHED_BUILD?: string
  INLINED_SOCKET_CLI_PYTHON_BUILD_TAG?: string
  INLINED_SOCKET_CLI_PYTHON_VERSION?: string
  INLINED_SOCKET_CLI_SENTRY_BUILD?: string
  INLINED_SOCKET_CLI_SYNP_VERSION?: string
  INLINED_SOCKET_CLI_UNIFIED_BUILD?: string
  INLINED_SOCKET_CLI_VERSION?: string
  INLINED_SOCKET_CLI_VERSION_HASH?: string

  // Configuration (NODE_ENV is defined in registry ENV).
  NODE_OPTIONS?: string
  SOCKET_CLI_ACCEPT_RISKS?: string
  SOCKET_CLI_CONFIG?: string
  SOCKET_CLI_FIX?: string
  SOCKET_CLI_GIT_USER_EMAIL?: string
  SOCKET_CLI_GIT_USER_NAME?: string
  SOCKET_CLI_GITHUB_TOKEN?: string
  SOCKET_CLI_MODE?: string
  SOCKET_CLI_OPTIMIZE?: string
  SOCKET_CLI_ORG_SLUG?: string
  SOCKET_CLI_VIEW_ALL_RISKS?: string

  // CI environment (CI itself is defined in registry ENV).
  GITHUB_API_URL?: string
  GITHUB_BASE_REF?: string
  GITHUB_REF_NAME?: string
  GITHUB_REF_TYPE?: string
  GITHUB_REPOSITORY?: string
  GITHUB_SERVER_URL?: string

  // Cache and configuration.
  DISABLE_GITHUB_CACHE?: string
  npm_config_cache?: string
  npm_config_user_agent?: string
  SOCKET_CLI_BIN_PATH?: string
  SOCKET_CLI_COANA_LOCAL_PATH?: string
  SOCKET_CLI_JS_PATH?: string
  SOCKET_CLI_NPM_PATH?: string

  // Testing.
  VITEST?: string
}

// Define the shape of registry ENV properties we use.
export interface RegistryEnvBase {
  CI: boolean
  GITHUB_TOKEN: string
  NODE_AUTH_TOKEN: string
  NODE_ENV: string
  NPM_TOKEN: string
  SOCKET_API_BASE_URL: string
  SOCKET_API_TOKEN: string
}

// Merge CLI env variables with registry env, letting registry properties take precedence.
// This avoids type conflicts for properties that exist in both interfaces.
type MergedEnv = RegistryEnvBase & Omit<CliEnvVariables, keyof RegistryEnvBase>

// Create a proxy that delegates to registry ENV but allows overrides.
const envHandler: ProxyHandler<MergedEnv> = {
  get(target, prop) {
    // Handle Socket CLI specific environment variables.
    if (typeof prop === 'string') {
      // Check for Socket CLI specific env vars first.
      if (
        prop.startsWith('SOCKET_CLI_') ||
        prop.startsWith('INLINED_SOCKET_CLI_')
      ) {
        const value = process.env[prop]
        if (value !== undefined) {
          return value
        }
      }
    }

    // Delegate to registry ENV.
    return Reflect.get(target, prop)
  },

  has(target, prop) {
    if (typeof prop === 'string') {
      // Check for Socket CLI specific env vars.
      if (
        prop.startsWith('SOCKET_CLI_') ||
        prop.startsWith('INLINED_SOCKET_CLI_')
      ) {
        return prop in process.env
      }
    }
    // Delegate to registry ENV.
    return Reflect.has(target, prop)
  },
}

// Create the proxied ENV object.
// Cast through unknown to satisfy TypeScript - the proxy ensures type safety at runtime.
const ENV = new Proxy(registryEnv as unknown as MergedEnv, envHandler)

// Export getters for commonly used environment variables.
// These provide type-safe access and avoid direct ENV references.
export function getApiToken(): string | undefined {
  return ENV.SOCKET_API_TOKEN
}

export function getApiBaseUrl(): string {
  return ENV.SOCKET_API_BASE_URL || 'https://api.socket.dev'
}

export function getRegistryUrl(): string {
  return ENV.SOCKET_REGISTRY_URL || 'https://registry.npmjs.org'
}

export function getNodeEnv(): string {
  return ENV.NODE_ENV || 'production'
}

export function isProduction(): boolean {
  return getNodeEnv() === 'production'
}

export function isDevelopment(): boolean {
  return getNodeEnv() === 'development'
}

export function isTest(): boolean {
  return getNodeEnv() === 'test' || !!ENV.VITEST
}

// Use direct process.env access (not ENV proxy) so rollup replace plugin can inline values.
export function getCliVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_VERSION']
}

// Use direct process.env access (not ENV proxy) so rollup replace plugin can inline values.
export function getCliVersionHash(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_VERSION_HASH']
}

// Use direct process.env access (not ENV proxy) so rollup replace plugin can inline values.
export function getCliHomepage(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_HOMEPAGE']
}

// Use direct process.env access (not ENV proxy) so rollup replace plugin can inline values.
export function getCliName(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_NAME']
}

export function isPublishedBuild(): boolean {
  return (
    ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD === '1' ||
    ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD === 'true'
  )
}

export function isLegacyBuild(): boolean {
  return (
    ENV.INLINED_SOCKET_CLI_LEGACY_BUILD === '1' ||
    ENV.INLINED_SOCKET_CLI_LEGACY_BUILD === 'true'
  )
}

export function isSentryBuild(): boolean {
  return (
    ENV.INLINED_SOCKET_CLI_SENTRY_BUILD === '1' ||
    ENV.INLINED_SOCKET_CLI_SENTRY_BUILD === 'true'
  )
}

export function isUnifiedBuild(): boolean {
  return (
    ENV.INLINED_SOCKET_CLI_UNIFIED_BUILD === '1' ||
    ENV.INLINED_SOCKET_CLI_UNIFIED_BUILD === 'true'
  )
}

export function getCliMode(): string | undefined {
  return ENV.SOCKET_CLI_MODE
}

export function getCoanaVersion(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION
}

export function getCdxgenVersion(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION
}

export function getSynpVersion(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_SYNP_VERSION
}

export function getPythonVersion(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_PYTHON_VERSION
}

export function getPythonBuildTag(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_PYTHON_BUILD_TAG
}

// Export the proxied ENV for backward compatibility.
// This should be avoided in new code - use the getter functions instead.
export default ENV
