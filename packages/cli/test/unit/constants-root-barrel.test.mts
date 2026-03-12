/**
 * Unit tests for root constants barrel file.
 *
 * Purpose:
 * Tests the root constants.mts barrel file exports.
 *
 * Test Coverage:
 * - Named exports verification
 * - Default export verification
 * - Key constants values
 *
 * Related Files:
 * - src/constants.mts (implementation)
 * - src/constants/*.mts (source modules)
 */

import { describe, expect, it } from 'vitest'

import constants, {
  // Agent constants.
  BUN,
  getMinimumVersionByAgent,
  getNpmExecPath,
  getPnpmExecPath,
  NPM,
  NPX,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
  // Alert type constants.
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
  // Cache constants.
  DLX_BINARY_CACHE_TTL,
  UPDATE_CHECK_TTL,
  UPDATE_NOTIFIER_TIMEOUT,
  // CLI constants.
  DRY_RUN_BAILING_NOW,
  DRY_RUN_LABEL,
  DRY_RUN_NOT_SAVING,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_ORG,
  FLAG_QUIET,
  FLAG_VERBOSE,
  FOLD_SETTING_FILE,
  FOLD_SETTING_NONE,
  FOLD_SETTING_PKG,
  FOLD_SETTING_VERSION,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  OUTPUT_TEXT,
  SEA_UPDATE_COMMAND,
  // Config constants.
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
  CONFIG_KEY_ENFORCED_ORGS,
  CONFIG_KEY_ORG,
  // Error constants.
  ERROR_NO_MANIFEST_FILES,
  ERROR_NO_PACKAGE_JSON,
  ERROR_NO_REPO_FOUND,
  ERROR_NO_SOCKET_DIR,
  ERROR_UNABLE_RESOLVE_ORG,
  LOOP_SENTINEL,
  // GitHub constants.
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
  SOCKET_CLI_GITHUB_REPO,
  // HTTP constants.
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
  NPM_REGISTRY_URL,
  // Package constants.
  EXT_LOCK,
  EXT_LOCKB,
  NODE_MODULES,
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_PACKAGE_NAME,
  YARN_LOCK,
  // Path constants.
  configPath,
  distPath,
  execPath,
  externalPath,
  getCliVersion,
  homePath,
  rootPath,
  srcPath,
  // Socket constants.
  API_V0_URL,
  SCAN_TYPE_SOCKET,
  SCAN_TYPE_SOCKET_TIER1,
  SOCKET_CLI_ISSUES_URL,
  SOCKET_DEFAULT_BRANCH,
  SOCKET_DEFAULT_REPOSITORY,
  SOCKET_WEBSITE_URL,
  TOKEN_PREFIX,
  TOKEN_PREFIX_LENGTH,
  // Type constants.
  WIN32,
  // Env constants.
  VITEST,
} from '../../src/constants.mts'

describe('constants root barrel exports', () => {
  describe('agent constants', () => {
    it('exports agent name constants', () => {
      expect(NPM).toBe('npm')
      expect(NPX).toBe('npx')
      expect(PNPM).toBe('pnpm')
      expect(YARN).toBe('yarn')
      expect(BUN).toBe('bun')
      expect(VLT).toBe('vlt')
      expect(YARN_CLASSIC).toBe('yarn/classic')
      expect(YARN_BERRY).toBe('yarn/berry')
    })

    it('exports agent utility functions', () => {
      expect(typeof getMinimumVersionByAgent).toBe('function')
      expect(typeof getNpmExecPath).toBe('function')
      expect(typeof getPnpmExecPath).toBe('function')
    })
  })

  describe('alert type constants', () => {
    it('exports alert types', () => {
      expect(ALERT_TYPE_CVE).toBe('cve')
      expect(ALERT_TYPE_CRITICAL_CVE).toBe('criticalCVE')
      expect(ALERT_TYPE_MEDIUM_CVE).toBe('mediumCVE')
      expect(ALERT_TYPE_MILD_CVE).toBe('mildCVE')
    })
  })

  describe('cache constants', () => {
    it('exports cache TTL values as numbers', () => {
      expect(typeof DLX_BINARY_CACHE_TTL).toBe('number')
      expect(typeof UPDATE_CHECK_TTL).toBe('number')
      expect(typeof UPDATE_NOTIFIER_TIMEOUT).toBe('number')
    })

    it('cache TTLs are positive', () => {
      expect(DLX_BINARY_CACHE_TTL).toBeGreaterThan(0)
      expect(UPDATE_CHECK_TTL).toBeGreaterThan(0)
      expect(UPDATE_NOTIFIER_TIMEOUT).toBeGreaterThan(0)
    })
  })

  describe('CLI flag constants', () => {
    it('exports flag constants with -- prefix', () => {
      expect(FLAG_DRY_RUN).toBe('--dry-run')
      expect(FLAG_HELP).toBe('--help')
      expect(FLAG_JSON).toBe('--json')
      expect(FLAG_ORG).toBe('--org')
      expect(FLAG_QUIET).toBe('--quiet')
      expect(FLAG_VERBOSE).toBe('--verbose')
      expect(FLAG_CONFIG).toBe('--config')
    })

    it('exports output format constants', () => {
      expect(OUTPUT_JSON).toBe('json')
      expect(OUTPUT_MARKDOWN).toBe('markdown')
      expect(OUTPUT_TEXT).toBe('text')
    })

    it('exports fold setting constants', () => {
      expect(typeof FOLD_SETTING_FILE).toBe('string')
      expect(typeof FOLD_SETTING_NONE).toBe('string')
      expect(typeof FOLD_SETTING_PKG).toBe('string')
      expect(typeof FOLD_SETTING_VERSION).toBe('string')
    })

    it('exports dry run message constants', () => {
      expect(typeof DRY_RUN_BAILING_NOW).toBe('string')
      expect(typeof DRY_RUN_LABEL).toBe('string')
      expect(typeof DRY_RUN_NOT_SAVING).toBe('string')
    })

    it('exports SEA update command', () => {
      expect(SEA_UPDATE_COMMAND).toBe('self-update')
    })
  })

  describe('config key constants', () => {
    it('exports config key constants', () => {
      expect(CONFIG_KEY_API_BASE_URL).toBe('apiBaseUrl')
      expect(CONFIG_KEY_API_PROXY).toBe('apiProxy')
      expect(CONFIG_KEY_API_TOKEN).toBe('apiToken')
      expect(CONFIG_KEY_DEFAULT_ORG).toBe('defaultOrg')
      expect(CONFIG_KEY_ENFORCED_ORGS).toBe('enforcedOrgs')
      expect(CONFIG_KEY_ORG).toBe('org')
    })
  })

  describe('error constants', () => {
    it('exports error message constants', () => {
      expect(typeof ERROR_NO_MANIFEST_FILES).toBe('string')
      expect(typeof ERROR_NO_PACKAGE_JSON).toBe('string')
      expect(typeof ERROR_NO_REPO_FOUND).toBe('string')
      expect(typeof ERROR_NO_SOCKET_DIR).toBe('string')
      expect(typeof ERROR_UNABLE_RESOLVE_ORG).toBe('string')
    })

    it('exports loop sentinel as a number', () => {
      expect(typeof LOOP_SENTINEL).toBe('number')
      expect(LOOP_SENTINEL).toBeGreaterThan(0)
    })
  })

  describe('GitHub constants', () => {
    it('exports GraphQL pagination sentinel', () => {
      expect(typeof GQL_PAGE_SENTINEL).toBe('number')
    })

    it('exports PR state constants', () => {
      expect(GQL_PR_STATE_OPEN).toBe('OPEN')
      expect(GQL_PR_STATE_CLOSED).toBe('CLOSED')
      expect(GQL_PR_STATE_MERGED).toBe('MERGED')
    })

    it('exports GitHub repo name', () => {
      expect(SOCKET_CLI_GITHUB_REPO).toBe('socket-cli')
    })
  })

  describe('HTTP constants', () => {
    it('exports HTTP status codes', () => {
      expect(HTTP_STATUS_BAD_REQUEST).toBe(400)
      expect(HTTP_STATUS_UNAUTHORIZED).toBe(401)
      expect(HTTP_STATUS_FORBIDDEN).toBe(403)
      expect(HTTP_STATUS_NOT_FOUND).toBe(404)
      expect(HTTP_STATUS_TOO_MANY_REQUESTS).toBe(429)
      expect(HTTP_STATUS_INTERNAL_SERVER_ERROR).toBe(500)
    })

    it('exports npm registry URL', () => {
      expect(NPM_REGISTRY_URL).toBe('https://registry.npmjs.org')
    })
  })

  describe('package constants', () => {
    it('exports file name constants', () => {
      expect(PACKAGE_JSON).toBe('package.json')
      expect(PACKAGE_LOCK_JSON).toBe('package-lock.json')
      expect(PNPM_LOCK_YAML).toBe('pnpm-lock.yaml')
      expect(YARN_LOCK).toBe('yarn.lock')
      expect(NODE_MODULES).toBe('node_modules')
    })

    it('exports extension constants', () => {
      expect(EXT_LOCK).toBe('.lock')
      expect(EXT_LOCKB).toBe('.lockb')
    })

    it('exports socket CLI name constants', () => {
      expect(SOCKET_CLI_BIN_NAME).toBe('socket')
      expect(SOCKET_CLI_PACKAGE_NAME).toBe('socket')
    })
  })

  describe('path constants', () => {
    it('exports path values as strings', () => {
      expect(typeof configPath).toBe('string')
      expect(typeof distPath).toBe('string')
      expect(typeof execPath).toBe('string')
      expect(typeof externalPath).toBe('string')
      expect(typeof homePath).toBe('string')
      expect(typeof rootPath).toBe('string')
      expect(typeof srcPath).toBe('string')
    })

    it('exports getCliVersion function', () => {
      expect(typeof getCliVersion).toBe('function')
    })
  })

  describe('Socket API constants', () => {
    it('exports API URL', () => {
      expect(API_V0_URL).toBe('https://api.socket.dev/v0/')
    })

    it('exports scan type constants', () => {
      expect(SCAN_TYPE_SOCKET).toBe('socket')
      expect(SCAN_TYPE_SOCKET_TIER1).toBe('socket_tier1')
    })

    it('exports Socket website constants', () => {
      expect(SOCKET_WEBSITE_URL).toBe('https://socket.dev')
      expect(SOCKET_CLI_ISSUES_URL).toBe(
        'https://github.com/SocketDev/socket-cli/issues',
      )
    })

    it('exports default branch and repository', () => {
      // These are config key-like identifiers, not actual values.
      expect(typeof SOCKET_DEFAULT_BRANCH).toBe('string')
      expect(typeof SOCKET_DEFAULT_REPOSITORY).toBe('string')
    })

    it('exports token constants', () => {
      expect(TOKEN_PREFIX).toBe('sktsec_')
      expect(TOKEN_PREFIX_LENGTH).toBe(7)
    })
  })

  describe('type constants', () => {
    it('exports WIN32 constant', () => {
      // WIN32 is process.platform === 'win32' boolean on non-Windows, string on Windows.
      expect(typeof WIN32 === 'boolean' || typeof WIN32 === 'string').toBe(true)
    })
  })

  describe('env constants', () => {
    it('exports VITEST as true in test environment', () => {
      expect(VITEST).toBe(true)
    })
  })

  describe('default export', () => {
    it('exports an object with constants', () => {
      expect(typeof constants).toBe('object')
      expect(constants).not.toBeNull()
    })

    it('includes ENV object', () => {
      expect(constants.ENV).toBeDefined()
      expect(typeof constants.ENV).toBe('object')
    })

    it('includes key constants', () => {
      expect(constants.NPM).toBe('npm')
      expect(constants.PNPM).toBe('pnpm')
      expect(constants.YARN).toBe('yarn')
      expect(constants.OUTPUT_JSON).toBe('json')
      expect(constants.OUTPUT_TEXT).toBe('text')
    })

    it('includes path constants', () => {
      expect(typeof constants.rootPath).toBe('string')
      expect(typeof constants.distPath).toBe('string')
      expect(typeof constants.srcPath).toBe('string')
    })

    it('includes getter functions', () => {
      expect(typeof constants.getCliVersion).toBe('function')
      expect(typeof constants.getMinimumVersionByAgent).toBe('function')
    })
  })
})
