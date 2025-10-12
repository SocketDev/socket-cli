/**
 * Environment variable configuration using proxy/getters to reference registry ENV.
 * This avoids circular dependencies while maintaining access to environment variables.
 */

import registryConstants from '@socketsecurity/registry/lib/constants'

// Extract the ENV object from registry constants if it exists.
const registryEnv = (registryConstants as any).ENV || {}

// Create a proxy that delegates to registry ENV but allows overrides.
const envHandler: ProxyHandler<typeof registryEnv> = {
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
const ENV = new Proxy(registryEnv, envHandler)

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

export function getCliVersion(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_VERSION
}

export function getCliVersionHash(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_VERSION_HASH
}

export function getCliHomepage(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_HOMEPAGE
}

export function getCliName(): string | undefined {
  return ENV.INLINED_SOCKET_CLI_NAME
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
