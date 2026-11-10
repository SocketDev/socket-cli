'use strict'

const path = require('node:path')

const { envAsBoolean } = require('./utils/registry-helpers.js')

const CONSTANTS = 'constants'
const INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION =
  'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION'
const INLINED_SOCKET_CLI_HOMEPAGE = 'INLINED_SOCKET_CLI_HOMEPAGE'
const INLINED_SOCKET_CLI_LEGACY_BUILD = 'INLINED_SOCKET_CLI_LEGACY_BUILD'
const INLINED_SOCKET_CLI_NAME = 'INLINED_SOCKET_CLI_NAME'
const INLINED_SOCKET_CLI_PUBLISHED_BUILD = 'INLINED_SOCKET_CLI_PUBLISHED_BUILD'
const INLINED_SOCKET_CLI_SENTRY_BUILD = 'INLINED_SOCKET_CLI_SENTRY_BUILD'
const INLINED_SOCKET_CLI_SYNP_VERSION = 'INLINED_SOCKET_CLI_SYNP_VERSION'
const INLINED_SOCKET_CLI_VERSION = 'INLINED_SOCKET_CLI_VERSION'
const INLINED_SOCKET_CLI_VERSION_HASH = 'INLINED_SOCKET_CLI_VERSION_HASH'
const INSTRUMENT_WITH_SENTRY = 'instrument-with-sentry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SHADOW_NPM_BIN = 'shadow-npm-bin'
const SHADOW_NPM_INJECT = 'shadow-npm-inject'
const SHADOW_NPX_BIN = 'shadow-npx-bin'
const SHADOW_PNPM_BIN = 'shadow-pnpm-bin'
const SHADOW_YARN_BIN = 'shadow-yarn-bin'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SOCKET_CLI_BIN_NAME = 'socket'
const SOCKET_CLI_BIN_NAME_ALIAS = 'cli'
const SOCKET_CLI_LEGACY_PACKAGE_NAME = '@socketsecurity/cli'
const SOCKET_CLI_NPM_BIN_NAME = 'socket-npm'
const SOCKET_CLI_NPX_BIN_NAME = 'socket-npx'
const SOCKET_CLI_PNPM_BIN_NAME = 'socket-pnpm'
const SOCKET_CLI_YARN_BIN_NAME = 'socket-yarn'
const SOCKET_CLI_PACKAGE_NAME = 'socket'
const SOCKET_CLI_SENTRY_BIN_NAME = 'socket-with-sentry'
const SOCKET_CLI_SENTRY_BIN_NAME_ALIAS = 'cli-with-sentry'
const SOCKET_CLI_SENTRY_NPM_BIN_NAME = 'socket-npm-with-sentry'
const SOCKET_CLI_SENTRY_NPX_BIN_NAME = 'socket-npx-with-sentry'
const SOCKET_CLI_SENTRY_PNPM_BIN_NAME = 'socket-pnpm-with-sentry'
const SOCKET_CLI_SENTRY_YARN_BIN_NAME = 'socket-yarn-with-sentry'
const SOCKET_CLI_SENTRY_PACKAGE_NAME = '@socketsecurity/cli-with-sentry'

const rootPath = path.resolve(__dirname, '..')
const externalPath = path.join(rootPath, 'external')
const env = Object.freeze({
  VITEST: envAsBoolean(process.env.VITEST),
  [INLINED_SOCKET_CLI_LEGACY_BUILD]: envAsBoolean(
    process.env[INLINED_SOCKET_CLI_LEGACY_BUILD],
  ),
  [INLINED_SOCKET_CLI_PUBLISHED_BUILD]: envAsBoolean(
    process.env[INLINED_SOCKET_CLI_PUBLISHED_BUILD],
  ),
  [INLINED_SOCKET_CLI_SENTRY_BUILD]: envAsBoolean(
    process.env[INLINED_SOCKET_CLI_SENTRY_BUILD],
  ),
})

module.exports = Object.freeze({
  CONSTANTS,
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
  INLINED_SOCKET_CLI_HOMEPAGE,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_NAME,
  INLINED_SOCKET_CLI_PUBLISHED_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INLINED_SOCKET_CLI_SYNP_VERSION,
  INLINED_SOCKET_CLI_VERSION,
  INLINED_SOCKET_CLI_VERSION_HASH,
  INSTRUMENT_WITH_SENTRY,
  ROLLUP_EXTERNAL_SUFFIX,
  SHADOW_NPM_BIN,
  SHADOW_NPM_INJECT,
  SHADOW_NPX_BIN,
  SHADOW_PNPM_BIN,
  SHADOW_YARN_BIN,
  SLASH_NODE_MODULES_SLASH,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_BIN_NAME_ALIAS,
  SOCKET_CLI_LEGACY_PACKAGE_NAME,
  SOCKET_CLI_NPM_BIN_NAME,
  SOCKET_CLI_NPX_BIN_NAME,
  SOCKET_CLI_PNPM_BIN_NAME,
  SOCKET_CLI_YARN_BIN_NAME,
  SOCKET_CLI_PACKAGE_NAME,
  SOCKET_CLI_SENTRY_BIN_NAME,
  SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
  SOCKET_CLI_SENTRY_NPM_BIN_NAME,
  SOCKET_CLI_SENTRY_NPX_BIN_NAME,
  SOCKET_CLI_SENTRY_PNPM_BIN_NAME,
  SOCKET_CLI_SENTRY_YARN_BIN_NAME,
  SOCKET_CLI_SENTRY_PACKAGE_NAME,
  ENV: env,
  blessedContribPath: path.join(externalPath, 'blessed-contrib'),
  blessedOptions: {},
  blessedPath: path.join(externalPath, 'blessed'),
  configPath: path.join(rootPath, '.config'),
  distPath: path.join(rootPath, 'dist'),
  externalPath,
  rootPackageJsonPath: path.join(rootPath, 'package.json'),
  rootPackageLockPath: path.join(rootPath, 'pnpm-lock.yaml'),
  rootPath,
  srcPath: path.join(rootPath, 'src'),
  AT_LATEST: '@latest',
  BIOME_JSON: 'biome.json',
  CI: 'CI',
  DOT_GIT_DIR: '.git',
  EMPTY_FILE: '/* empty */\n',
  ESLINT_CONFIG_JS: 'eslint.config.js',
  GITIGNORE: '.gitignore',
  LATEST: 'latest',
  LICENSE: 'LICENSE',
  LICENSE_GLOB: 'LICEN[CS]E{[.-]*,}',
  LICENSE_GLOB_RECURSIVE: '**/LICEN[CS]E{[.-]*,}',
  MANIFEST_JSON: 'manifest.json',
  NODE_MODULES: 'node_modules',
  NODE_MODULES_GLOB_RECURSIVE: '**/node_modules',
  PACKAGE_JSON: 'package.json',
  PACKAGE_LOCK_JSON: 'package-lock.json',
  PNPM_LOCK_YAML: 'pnpm-lock.yaml',
  README_MD: 'README.md',
  TSCONFIG_JSON: 'tsconfig.json',
  UTF8: 'utf8',
  VITEST: 'VITEST',
})
