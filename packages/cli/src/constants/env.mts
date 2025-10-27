/**
 * Environment variable configuration using direct imports from env modules.
 * This provides centralized access to environment variables without proxies.
 */

import process, { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

// Import CLI-specific env modules.
import { CI } from '../env/ci.mts'
import { DISABLE_GITHUB_CACHE } from '../env/disable-github-cache.mts'
import { GITHUB_API_URL } from '../env/github-api-url.mts'
import { HOME } from '../env/home.mts'
import { LOCALAPPDATA } from '../env/localappdata.mts'
import { GITHUB_BASE_REF } from '../env/github-base-ref.mts'
import { GITHUB_REF_NAME } from '../env/github-ref-name.mts'
import { GITHUB_REF_TYPE } from '../env/github-ref-type.mts'
import { GITHUB_SERVER_URL } from '../env/github-server-url.mts'
import { NODE_ENV } from '../env/node-env.mts'
import { NODE_OPTIONS } from '../env/node-options.mts'
import { npm_config_cache } from '../env/npm-config-cache.mts'
import { npm_config_user_agent } from '../env/npm-config-user-agent.mts'
import { SOCKET_CLI_ACCEPT_RISKS } from '../env/socket-cli-accept-risks.mts'
import { SOCKET_CLI_API_BASE_URL } from '../env/socket-cli-api-base-url.mts'
import { SOCKET_CLI_API_PROXY } from '../env/socket-cli-api-proxy.mts'
import { SOCKET_CLI_API_TIMEOUT } from '../env/socket-cli-api-timeout.mts'
import { SOCKET_CLI_API_TOKEN } from '../env/socket-cli-api-token.mts'
import { SOCKET_CLI_BIN_PATH } from '../env/socket-cli-bin-path.mts'
import { SOCKET_CLI_CDXGEN_LOCAL_PATH } from '../env/socket-cli-cdxgen-local-path.mts'
import { SOCKET_CLI_COANA_LOCAL_PATH } from '../env/socket-cli-coana-local-path.mts'
import { SOCKET_CLI_CONFIG } from '../env/socket-cli-config.mts'
import { SOCKET_CLI_DEBUG } from '../env/socket-cli-debug.mts'
import { SOCKET_CLI_FIX } from '../env/socket-cli-fix.mts'
import { SOCKET_CLI_GIT_USER_EMAIL } from '../env/socket-cli-git-user-email.mts'
import { SOCKET_CLI_GIT_USER_NAME } from '../env/socket-cli-git-user-name.mts'
import { SOCKET_CLI_GITHUB_TOKEN } from '../env/socket-cli-github-token.mts'
import { SOCKET_CLI_JS_PATH } from '../env/socket-cli-js-path.mts'
import { SOCKET_CLI_LOCAL_PATH } from '../env/socket-cli-local-path.mts'
import { SOCKET_CLI_MODE } from '../env/socket-cli-mode.mts'
import { SOCKET_CLI_NO_API_TOKEN } from '../env/socket-cli-no-api-token.mts'
import { SOCKET_CLI_NPM_PATH } from '../env/socket-cli-npm-path.mts'
import { SOCKET_CLI_OPTIMIZE } from '../env/socket-cli-optimize.mts'
import { SOCKET_CLI_PYCLI_LOCAL_PATH } from '../env/socket-cli-pycli-local-path.mts'
import { SOCKET_CLI_SFW_LOCAL_PATH } from '../env/socket-cli-sfw-local-path.mts'
import { SOCKET_CLI_VIEW_ALL_RISKS } from '../env/socket-cli-view-all-risks.mts'
import { RUN_E2E_TESTS } from '../env/run-e2e-tests.mts'
import { TEMP } from '../env/temp.mts'
import { TERM } from '../env/term.mts'
import { TMP } from '../env/tmp.mts'
import { USERPROFILE } from '../env/userprofile.mts'
import { VITEST } from '../env/vitest.mts'
import { XDG_CACHE_HOME } from '../env/xdg-cache-home.mts'
import { XDG_DATA_HOME } from '../env/xdg-data-home.mts'

// Re-export CLI-specific env variables.
export {
  CI,
  DISABLE_GITHUB_CACHE,
  GITHUB_API_URL,
  GITHUB_BASE_REF,
  GITHUB_REF_NAME,
  GITHUB_REF_TYPE,
  GITHUB_SERVER_URL,
  HOME,
  LOCALAPPDATA,
  NODE_ENV,
  NODE_OPTIONS,
  npm_config_cache,
  npm_config_user_agent,
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_API_BASE_URL,
  SOCKET_CLI_API_PROXY,
  SOCKET_CLI_API_TIMEOUT,
  SOCKET_CLI_API_TOKEN,
  SOCKET_CLI_BIN_PATH,
  SOCKET_CLI_CDXGEN_LOCAL_PATH,
  SOCKET_CLI_COANA_LOCAL_PATH,
  SOCKET_CLI_CONFIG,
  SOCKET_CLI_DEBUG,
  SOCKET_CLI_FIX,
  SOCKET_CLI_GIT_USER_EMAIL,
  SOCKET_CLI_GIT_USER_NAME,
  SOCKET_CLI_GITHUB_TOKEN,
  SOCKET_CLI_JS_PATH,
  SOCKET_CLI_LOCAL_PATH,
  SOCKET_CLI_MODE,
  SOCKET_CLI_NO_API_TOKEN,
  SOCKET_CLI_NPM_PATH,
  SOCKET_CLI_OPTIMIZE,
  SOCKET_CLI_PYCLI_LOCAL_PATH,
  SOCKET_CLI_SFW_LOCAL_PATH,
  SOCKET_CLI_VIEW_ALL_RISKS,
  RUN_E2E_TESTS,
  TEMP,
  TERM,
  TMP,
  USERPROFILE,
  VITEST,
  XDG_CACHE_HOME,
  XDG_DATA_HOME,
}

// Getter functions for build metadata.
// Use direct process.env access (not env imports) so esbuild define can inline values.
// IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
// If we imported these from env modules, esbuild couldn't inline the values at build time.
// This is critical for embedding version info, build tags, and feature flags into the binary.
export function getCliVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_VERSION']
}

export function getCliVersionHash(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_VERSION_HASH']
}

export function getCliHomepage(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_HOMEPAGE']
}

export function getCliName(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_NAME']
}

export function isPublishedBuild(): boolean {
  return envAsBoolean(process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'])
}

export function isLegacyBuild(): boolean {
  return envAsBoolean(process.env['INLINED_SOCKET_CLI_LEGACY_BUILD'])
}

export function isSentryBuild(): boolean {
  return envAsBoolean(process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'])
}

export function getCliAiVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_AI_VERSION']
}

export function getCoanaVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_COANA_VERSION']
}

export function getCdxgenVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION']
}

export function getSynpVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_SYNP_VERSION']
}

export function getPythonVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_PYTHON_VERSION']
}

export function getPythonBuildTag(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_PYTHON_BUILD_TAG']
}

// Export processEnv for backward compatibility with shadow npm integration.
// This provides access to process.env for spawned processes.
export const processEnv = env

// Legacy default export for backward compatibility.
// This should be avoided in new code - use the named exports instead.
// IMPORTANT: Build metadata properties use direct process.env access (not env imports)
// so esbuild's define plugin can inline the values at build time. This is critical for
// embedding version info, build tags, and feature flags into the compiled binary.

// Create a snapshot of environment variables for production use.
const envSnapshot = {
  CI,
  DISABLE_GITHUB_CACHE,
  GITHUB_API_URL,
  GITHUB_BASE_REF,
  GITHUB_REF_NAME,
  GITHUB_REF_TYPE,
  GITHUB_SERVER_URL,
  HOME,
  LOCALAPPDATA,
  NODE_ENV,
  NODE_OPTIONS,
  npm_config_cache,
  npm_config_user_agent,
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_API_BASE_URL,
  SOCKET_CLI_API_PROXY,
  SOCKET_CLI_API_TIMEOUT,
  SOCKET_CLI_API_TOKEN,
  SOCKET_CLI_BIN_PATH,
  SOCKET_CLI_CDXGEN_LOCAL_PATH,
  SOCKET_CLI_COANA_LOCAL_PATH,
  SOCKET_CLI_CONFIG,
  SOCKET_CLI_DEBUG,
  SOCKET_CLI_FIX,
  SOCKET_CLI_GIT_USER_EMAIL,
  SOCKET_CLI_GIT_USER_NAME,
  SOCKET_CLI_GITHUB_TOKEN,
  SOCKET_CLI_JS_PATH,
  SOCKET_CLI_LOCAL_PATH,
  SOCKET_CLI_MODE,
  SOCKET_CLI_NO_API_TOKEN,
  SOCKET_CLI_NPM_PATH,
  SOCKET_CLI_OPTIMIZE,
  SOCKET_CLI_PYCLI_LOCAL_PATH,
  SOCKET_CLI_SFW_LOCAL_PATH,
  SOCKET_CLI_VIEW_ALL_RISKS,
  RUN_E2E_TESTS,
  TEMP,
  TERM,
  TMP,
  USERPROFILE,
  VITEST,
  XDG_CACHE_HOME,
  XDG_DATA_HOME,
  // Additional environment variables (accessed via ENV object).
  GITHUB_REPOSITORY: env['GITHUB_REPOSITORY'],
  SOCKET_CLI_ORG_SLUG: env['SOCKET_CLI_ORG_SLUG'],
  // Build metadata (inlined by esbuild define).
  INLINED_SOCKET_CLI_AI_VERSION: process.env['INLINED_SOCKET_CLI_AI_VERSION'],
  INLINED_SOCKET_CLI_CDXGEN_VERSION:
    process.env['INLINED_SOCKET_CLI_CDXGEN_VERSION'],
  INLINED_SOCKET_CLI_COANA_VERSION:
    process.env['INLINED_SOCKET_CLI_COANA_VERSION'],
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION:
    process.env['INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION'],
  INLINED_SOCKET_CLI_HOMEPAGE: process.env['INLINED_SOCKET_CLI_HOMEPAGE'],
  INLINED_SOCKET_CLI_LEGACY_BUILD:
    process.env['INLINED_SOCKET_CLI_LEGACY_BUILD'],
  INLINED_SOCKET_CLI_NAME: process.env['INLINED_SOCKET_CLI_NAME'],
  INLINED_SOCKET_CLI_PUBLISHED_BUILD:
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'],
  INLINED_SOCKET_CLI_PYTHON_BUILD_TAG:
    process.env['INLINED_SOCKET_CLI_PYTHON_BUILD_TAG'],
  INLINED_SOCKET_CLI_PYTHON_VERSION:
    process.env['INLINED_SOCKET_CLI_PYTHON_VERSION'],
  INLINED_SOCKET_CLI_SENTRY_BUILD:
    process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'],
  INLINED_SOCKET_CLI_SYNP_VERSION:
    process.env['INLINED_SOCKET_CLI_SYNP_VERSION'],
  INLINED_SOCKET_CLI_VERSION: process.env['INLINED_SOCKET_CLI_VERSION'],
  INLINED_SOCKET_CLI_VERSION_HASH:
    process.env['INLINED_SOCKET_CLI_VERSION_HASH'],
}

// Create a Proxy that uses live process.env in VITEST mode and snapshot in production.
// This allows tests to manipulate process.env and see those changes reflected in ENV,
// while production builds use the more efficient snapshot.
// Check if we're in VITEST mode once at module load time.
const isVitestMode = Boolean(process.env['VITEST'])

const ENV = new Proxy(envSnapshot, {
  get(target, prop) {
    // In VITEST mode, prefer process.env for dynamic test scenarios.
    // Fall back to snapshot for build-time values (INLINED_*) and other non-env properties.
    if (isVitestMode && typeof prop === 'string') {
      // Check if the property exists in process.env.
      // If it does, use it (allows tests to manipulate env vars).
      // If not, fall back to snapshot (for INLINED_* and other values).
      if (prop in process.env) {
        return process.env[prop]
      }
    }
    return Reflect.get(target, prop)
  },
  has(target, prop) {
    if (isVitestMode && typeof prop === 'string') {
      return prop in process.env || Reflect.has(target, prop)
    }
    return Reflect.has(target, prop)
  },
  ownKeys(target) {
    if (isVitestMode) {
      // Merge keys from both process.env and snapshot.
      const envKeys = Reflect.ownKeys(process.env)
      const snapshotKeys = Reflect.ownKeys(target)
      return [...new Set([...envKeys, ...snapshotKeys])]
    }
    return Reflect.ownKeys(target)
  },
  getOwnPropertyDescriptor(target, prop) {
    if (isVitestMode && typeof prop === 'string') {
      if (prop in process.env) {
        return {
          configurable: true,
          enumerable: true,
          value: process.env[prop],
        }
      }
    }
    return Reflect.getOwnPropertyDescriptor(target, prop)
  },
})

// Named export for ES module imports.
export { ENV }
export default ENV
