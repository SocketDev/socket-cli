/**
 * Environment variable configuration using direct imports from env modules.
 * This provides centralized access to environment variables without proxies.
 */

import process, { env } from 'node:process'

// Import CLI-specific env modules.
import { getCdxgenVersion } from '../env/cdxgen-version.mts'
import { CI } from '../env/ci.mts'
import { getCliHomepage } from '../env/cli-homepage.mts'
import { getCliName } from '../env/cli-name.mts'
import { getCliVersionHash } from '../env/cli-version-hash.mts'
import { getCliVersion } from '../env/cli-version.mts'
import { getCoanaVersion } from '../env/coana-version.mts'
import { DISABLE_GITHUB_CACHE } from '../env/disable-github-cache.mts'
import { GITHUB_API_URL } from '../env/github-api-url.mts'
import { GITHUB_BASE_REF } from '../env/github-base-ref.mts'
import { GITHUB_REF_NAME } from '../env/github-ref-name.mts'
import { GITHUB_REF_TYPE } from '../env/github-ref-type.mts'
import { GITHUB_REPOSITORY } from '../env/github-repository.mts'
import { GITHUB_SERVER_URL } from '../env/github-server-url.mts'
import { HOME } from '../env/home.mts'
import { isLegacyBuild } from '../env/is-legacy-build.mts'
import { isPublishedBuild } from '../env/is-published-build.mts'
import { isSentryBuild } from '../env/is-sentry-build.mts'
import { LOCALAPPDATA } from '../env/localappdata.mts'
import { NODE_ENV } from '../env/node-env.mts'
import { NODE_OPTIONS } from '../env/node-options.mts'
import { npm_config_cache } from '../env/npm-config-cache.mts'
import { npm_config_user_agent } from '../env/npm-config-user-agent.mts'
import { getPyCliVersion } from '../env/pycli-version.mts'
import { getPythonBuildTag } from '../env/python-build-tag.mts'
import { getPythonVersion } from '../env/python-version.mts'
import { RUN_E2E_TESTS } from '../env/run-e2e-tests.mts'
import { SOCKET_CLI_ACCEPT_RISKS } from '../env/socket-cli-accept-risks.mts'
import { SOCKET_CLI_API_BASE_URL } from '../env/socket-cli-api-base-url.mts'
import { SOCKET_CLI_API_PROXY } from '../env/socket-cli-api-proxy.mts'
import { SOCKET_CLI_API_TIMEOUT } from '../env/socket-cli-api-timeout.mts'
import { SOCKET_CLI_API_TOKEN } from '../env/socket-cli-api-token.mts'
import { SOCKET_CLI_BIN_PATH } from '../env/socket-cli-bin-path.mts'
import { SOCKET_CLI_BOOTSTRAP_CACHE_DIR } from '../env/socket-cli-bootstrap-cache-dir.mts'
import { SOCKET_CLI_BOOTSTRAP_SPEC } from '../env/socket-cli-bootstrap-spec.mts'
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
import { SOCKET_CLI_MODELS_PATH } from '../env/socket-cli-models-path.mts'
import { SOCKET_CLI_NO_API_TOKEN } from '../env/socket-cli-no-api-token.mts'
import { SOCKET_CLI_NODE_DOWNLOAD_URL } from '../env/socket-cli-node-download-url.mts'
import { SOCKET_CLI_NPM_PATH } from '../env/socket-cli-npm-path.mts'
import { SOCKET_CLI_OPTIMIZE } from '../env/socket-cli-optimize.mts'
import { SOCKET_CLI_ORG_SLUG } from '../env/socket-cli-org-slug.mts'
import { SOCKET_CLI_PYCLI_LOCAL_PATH } from '../env/socket-cli-pycli-local-path.mts'
import { SOCKET_CLI_SEA_NODE_VERSION } from '../env/socket-cli-sea-node-version.mts'
import { SOCKET_CLI_SFW_LOCAL_PATH } from '../env/socket-cli-sfw-local-path.mts'
import { SOCKET_CLI_VIEW_ALL_RISKS } from '../env/socket-cli-view-all-risks.mts'
import { getSynpVersion } from '../env/synp-version.mts'
import { TEMP } from '../env/temp.mts'
import { TERM } from '../env/term.mts'
import { TMP } from '../env/tmp.mts'
import { USERPROFILE } from '../env/userprofile.mts'
import { VITEST } from '../env/vitest.mts'
import { XDG_CACHE_HOME } from '../env/xdg-cache-home.mts'
import { XDG_DATA_HOME } from '../env/xdg-data-home.mts'

// Import build metadata getter functions.

// Re-export CLI-specific env variables.
export {
  CI,
  DISABLE_GITHUB_CACHE,
  GITHUB_API_URL,
  GITHUB_BASE_REF,
  GITHUB_REF_NAME,
  GITHUB_REF_TYPE,
  GITHUB_REPOSITORY,
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
  SOCKET_CLI_BOOTSTRAP_CACHE_DIR,
  SOCKET_CLI_BOOTSTRAP_SPEC,
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
  SOCKET_CLI_MODELS_PATH,
  SOCKET_CLI_NODE_DOWNLOAD_URL,
  SOCKET_CLI_NO_API_TOKEN,
  SOCKET_CLI_NPM_PATH,
  SOCKET_CLI_OPTIMIZE,
  SOCKET_CLI_ORG_SLUG,
  SOCKET_CLI_PYCLI_LOCAL_PATH,
  SOCKET_CLI_SEA_NODE_VERSION,
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

// Re-export build metadata getter functions.
export {
  getCdxgenVersion,
  getCliHomepage,
  getCliName,
  getCliVersion,
  getCliVersionHash,
  getCoanaVersion,
  getPyCliVersion,
  getPythonBuildTag,
  getPythonVersion,
  getSynpVersion,
  isLegacyBuild,
  isPublishedBuild,
  isSentryBuild,
}

// Export processEnv for backward compatibility with shadow npm integration.
// This provides access to process.env for spawned processes.
export const processEnv = env

// Legacy default export for backward compatibility.
// This should be avoided in new code - use the named exports instead.

// Create a snapshot of environment variables for production use.
const envSnapshot = {
  CI,
  DISABLE_GITHUB_CACHE,
  GITHUB_API_URL,
  GITHUB_BASE_REF,
  GITHUB_REF_NAME,
  GITHUB_REF_TYPE,
  GITHUB_REPOSITORY,
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
  SOCKET_CLI_BOOTSTRAP_CACHE_DIR,
  SOCKET_CLI_BOOTSTRAP_SPEC,
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
  SOCKET_CLI_MODELS_PATH,
  SOCKET_CLI_NODE_DOWNLOAD_URL,
  SOCKET_CLI_NO_API_TOKEN,
  SOCKET_CLI_NPM_PATH,
  SOCKET_CLI_OPTIMIZE,
  SOCKET_CLI_ORG_SLUG,
  SOCKET_CLI_PYCLI_LOCAL_PATH,
  SOCKET_CLI_SEA_NODE_VERSION,
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
  // Build metadata (inlined by esbuild define).
  INLINED_SOCKET_CLI_CDXGEN_VERSION: getCdxgenVersion(),
  INLINED_SOCKET_CLI_COANA_VERSION: getCoanaVersion(),
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: getCdxgenVersion(),
  INLINED_SOCKET_CLI_HOMEPAGE: getCliHomepage(),
  INLINED_SOCKET_CLI_LEGACY_BUILD: isLegacyBuild(),
  INLINED_SOCKET_CLI_NAME: getCliName(),
  INLINED_SOCKET_CLI_PUBLISHED_BUILD: isPublishedBuild(),
  INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: getPythonBuildTag(),
  INLINED_SOCKET_CLI_PYTHON_VERSION: getPythonVersion(),
  INLINED_SOCKET_CLI_PYCLI_VERSION: getPyCliVersion(),
  INLINED_SOCKET_CLI_SENTRY_BUILD: isSentryBuild(),
  INLINED_SOCKET_CLI_SYNP_VERSION: getSynpVersion(),
  INLINED_SOCKET_CLI_VERSION: getCliVersion(),
  INLINED_SOCKET_CLI_VERSION_HASH: getCliVersionHash(),
}

// Create a Proxy that uses live process.env in VITEST mode and snapshot in production.
// This allows tests to manipulate process.env and see those changes reflected in ENV,
// while production builds use the more efficient snapshot.
// Check if we're in VITEST mode once at module load time.
const isVitestMode = !!VITEST

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
          writable: true,
          value: process.env[prop],
        }
      }
    }
    return Reflect.getOwnPropertyDescriptor(target, prop)
  },
  set(_target, prop, value) {
    // In VITEST mode, allow setting values to process.env.
    // This enables tests to modify environment variables dynamically.
    if (isVitestMode && typeof prop === 'string') {
      process.env[prop] = value
      return true
    }
    // In production, ENV is read-only.
    return false
  },
})

// Named export for ES module imports.
export { ENV }
export default ENV
