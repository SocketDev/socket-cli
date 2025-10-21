/**
 * Environment variable configuration using direct imports from env modules.
 * This provides centralized access to environment variables without proxies.
 */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

// Import CLI-specific env modules.
import { DISABLE_GITHUB_CACHE } from '../env/disable-github-cache.mts'
import { GITHUB_API_URL } from '../env/github-api-url.mts'
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
import { SOCKET_CLI_COANA_LOCAL_PATH } from '../env/socket-cli-coana-local-path.mts'
import { SOCKET_CLI_CONFIG } from '../env/socket-cli-config.mts'
import { SOCKET_CLI_DEBUG } from '../env/socket-cli-debug.mts'
import { SOCKET_CLI_FIX } from '../env/socket-cli-fix.mts'
import { SOCKET_CLI_GIT_USER_EMAIL } from '../env/socket-cli-git-user-email.mts'
import { SOCKET_CLI_GIT_USER_NAME } from '../env/socket-cli-git-user-name.mts'
import { SOCKET_CLI_GITHUB_TOKEN } from '../env/socket-cli-github-token.mts'
import { SOCKET_CLI_JS_PATH } from '../env/socket-cli-js-path.mts'
import { SOCKET_CLI_MODE } from '../env/socket-cli-mode.mts'
import { SOCKET_CLI_NO_API_TOKEN } from '../env/socket-cli-no-api-token.mts'
import { SOCKET_CLI_NPM_PATH } from '../env/socket-cli-npm-path.mts'
import { SOCKET_CLI_OPTIMIZE } from '../env/socket-cli-optimize.mts'
import { SOCKET_CLI_VIEW_ALL_RISKS } from '../env/socket-cli-view-all-risks.mts'
import { VITEST } from '../env/vitest.mts'

// Re-export CLI-specific env variables.
export {
  DISABLE_GITHUB_CACHE,
  GITHUB_API_URL,
  GITHUB_BASE_REF,
  GITHUB_REF_NAME,
  GITHUB_REF_TYPE,
  GITHUB_SERVER_URL,
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
  SOCKET_CLI_COANA_LOCAL_PATH,
  SOCKET_CLI_CONFIG,
  SOCKET_CLI_DEBUG,
  SOCKET_CLI_FIX,
  SOCKET_CLI_GIT_USER_EMAIL,
  SOCKET_CLI_GIT_USER_NAME,
  SOCKET_CLI_GITHUB_TOKEN,
  SOCKET_CLI_JS_PATH,
  SOCKET_CLI_MODE,
  SOCKET_CLI_NO_API_TOKEN,
  SOCKET_CLI_NPM_PATH,
  SOCKET_CLI_OPTIMIZE,
  SOCKET_CLI_VIEW_ALL_RISKS,
  VITEST,
}

// Getter functions for build metadata.
// Use direct process.env access (not env imports) so rollup replace plugin can inline values.
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

export function getCoanaVersion(): string | undefined {
  return process.env['INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION']
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
const ENV = {
  DISABLE_GITHUB_CACHE,
  GITHUB_API_URL,
  GITHUB_BASE_REF,
  GITHUB_REF_NAME,
  GITHUB_REF_TYPE,
  GITHUB_SERVER_URL,
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
  SOCKET_CLI_COANA_LOCAL_PATH,
  SOCKET_CLI_CONFIG,
  SOCKET_CLI_DEBUG,
  SOCKET_CLI_FIX,
  SOCKET_CLI_GIT_USER_EMAIL,
  SOCKET_CLI_GIT_USER_NAME,
  SOCKET_CLI_GITHUB_TOKEN,
  SOCKET_CLI_JS_PATH,
  SOCKET_CLI_MODE,
  SOCKET_CLI_NO_API_TOKEN,
  SOCKET_CLI_NPM_PATH,
  SOCKET_CLI_OPTIMIZE,
  SOCKET_CLI_VIEW_ALL_RISKS,
  VITEST,
  // Additional environment variables (accessed via ENV object).
  CI: env['CI'],
  GITHUB_REPOSITORY: env['GITHUB_REPOSITORY'],
  SOCKET_CLI_ORG_SLUG: env['SOCKET_CLI_ORG_SLUG'],
  // Build metadata (inlined by rollup replace plugin).
  INLINED_SOCKET_CLI_CDXGEN_VERSION:
    process.env['INLINED_SOCKET_CLI_CDXGEN_VERSION'],
  INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION:
    process.env['INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION'],
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

// Named export for ES module imports.
export { ENV }
export default ENV
