import { randomUUID } from 'node:crypto'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
import typescriptPlugin from '@rollup/plugin-typescript'
import { purgePolyfills } from 'unplugin-purge-polyfills'

import { readPackageJsonSync } from '@socketsecurity/registry/lib/packages'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId
} from '../scripts/utils/packages.js'

const {
  CONSTANTS,
  INLINED_CYCLONEDX_CDXGEN_VERSION,
  INLINED_SOCKET_CLI_HOMEPAGE,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_NAME,
  INLINED_SOCKET_CLI_PUBLISHED_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INLINED_SOCKET_CLI_VERSION,
  INLINED_SOCKET_CLI_VERSION_HASH,
  INLINED_SYNP_VERSION,
  INSTRUMENT_WITH_SENTRY,
  ROLLUP_EXTERNAL_SUFFIX,
  SHADOW_NPM_BIN,
  SHADOW_NPM_INJECT,
  SHADOW_NPM_PATHS,
  SLASH_NODE_MODULES_SLASH,
  VENDOR,
  VITEST
} = constants

export const EXTERNAL_PACKAGES = [
  '@socketsecurity/registry',
  'blessed',
  'blessed-contrib'
]

const builtinAliases = builtinModules.reduce((o, n) => {
  o[n] = `node:${n}`
  return o
}, {})

const danglingRequiresRegExp = /^\s*require\(["'].+?["']\);?\r?\n/gm

const requireTinyColorsRegExp = /require\(["']tiny-colors["']\)/g

const requireUrlAssignmentRegExp =
  /(?<=var +)[$\w]+(?= *= *require\(["']node:url["']\))/

const splitUrlRequiresRegExp = /require\(["']u["']\s*\+\s*["']rl["']\)/g

let _rootPkgJson
function getRootPkgJsonSync() {
  if (_rootPkgJson === undefined) {
    // Lazily access constants.rootPath.
    _rootPkgJson = readPackageJsonSync(constants.rootPath)
  }
  return _rootPkgJson
}

let _socketVersionHash
function getSocketCliVersionHash() {
  if (_socketVersionHash === undefined) {
    const randUuidSegment = randomUUID().split('-')[0]
    const { version } = getRootPkgJsonSync()
    let gitHash = ''
    try {
      gitHash = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8'
      }).stdout.trim()
    } catch {}
    // Make each build generate a unique version id, regardless.
    // Mostly for development: confirms the build refreshed. For prod builds
    // the git hash should suffice to identify the build.
    _socketVersionHash = `${version}:${gitHash}:${randUuidSegment}${
      // Lazily access constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD].
      constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD] ? ':pub' : ':dev'
    }`
  }
  return _socketVersionHash
}

export default function baseConfig(extendConfig = {}) {
  // Lazily access constants.rootSrcPath.
  const { rootSrcPath } = constants
  const constantsSrcPath = path.join(rootSrcPath, `constants.ts`)
  const shadowNpmBinSrcPath = path.join(rootSrcPath, 'shadow/npm/bin.ts')
  const shadowNpmInjectSrcPath = path.join(rootSrcPath, 'shadow/npm/inject.ts')
  const shadowNpmPathsSrcPath = path.join(rootSrcPath, 'shadow/npm/paths.ts')

  const extendPlugins = Array.isArray(extendConfig.plugins)
    ? extendConfig.plugins.slice()
    : []
  const extractedPlugins = { __proto__: null }
  if (extendPlugins.length) {
    for (const pluginName of [
      'babel',
      'commonjs',
      'json',
      'node-resolve',
      'typescript',
      'unplugin-purge-polyfills'
    ]) {
      for (let i = 0, { length } = extendPlugins; i < length; i += 1) {
        const p = extendPlugins[i]
        if (p?.name === pluginName) {
          extractedPlugins[pluginName] = p
          // Remove from extendPlugins array.
          extendPlugins.splice(i, 1)
          length -= 1
          i -= 1
        }
      }
    }
  }

  const config = {
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      [CONSTANTS]: `${rootSrcPath}/constants.ts`,
      [SHADOW_NPM_BIN]: `${rootSrcPath}/shadow/npm/bin.ts`,
      [SHADOW_NPM_INJECT]: `${rootSrcPath}/shadow/npm/inject.ts`,
      // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
      ...(constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
        ? {
            [INSTRUMENT_WITH_SENTRY]: `${rootSrcPath}/${INSTRUMENT_WITH_SENTRY}.ts`
          }
        : {})
    },
    external(id_) {
      const id = normalizeId(id_)
      if (id.includes('blessed')) {
        console.log(
          id,
          getPackageName(id),
          EXTERNAL_PACKAGES.includes(getPackageName(id))
        )
      }
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      return (
        id.endsWith('.d.cts') ||
        id.endsWith('.d.mts') ||
        id.endsWith('.d.ts') ||
        EXTERNAL_PACKAGES.includes(getPackageName(id))
      )
    },
    onwarn(warning, warn) {
      // Suppress warnings.
      if (
        warning.code === 'INVALID_ANNOTATION' ||
        warning.code === 'THIS_IS_UNDEFINED'
      ) {
        return
      }
      // Forward other warnings.
      warn(warning)
    },
    ...extendConfig,
    plugins: [
      extractedPlugins['node-resolve'] ??
        nodeResolve({
          exportConditions: ['node'],
          extensions: ['.mjs', '.js', '.json', '.ts'],
          preferBuiltins: true
        }),
      extractedPlugins['json'] ?? jsonPlugin(),
      extractedPlugins['typescript'] ??
        typescriptPlugin({
          include: ['src/**/*.ts'],
          noForceEmit: true,
          outputToFilesystem: true,
          // Lazily access constants.rootConfigPath.
          tsconfig: path.join(constants.rootConfigPath, 'tsconfig.rollup.json')
        }),
      extractedPlugins['commonjs'] ??
        commonjsPlugin({
          defaultIsModuleExports: true,
          extensions: ['.cjs', '.js'],
          ignoreDynamicRequires: true,
          ignoreGlobal: true,
          ignoreTryCatch: true,
          strictRequires: true
        }),
      extractedPlugins['babel'] ??
        babelPlugin({
          babelHelpers: 'runtime',
          babelrc: false,
          // Lazily access constants.rootConfigPath.
          configFile: path.join(constants.rootConfigPath, 'babel.config.js'),
          extensions: ['.ts', '.js', '.cjs', '.mjs']
        }),
      extractedPlugins['unplugin-purge-polyfills'] ??
        purgePolyfills.rollup({
          replacements: {}
        }),
      // Inline process.env values.
      replacePlugin({
        delimiters: ['(?<![\'"])\\b', '(?![\'"])'],
        preventAssignment: true,
        values: [
          [
            INLINED_CYCLONEDX_CDXGEN_VERSION,
            () =>
              JSON.stringify(
                getRootPkgJsonSync().devDependencies['@cyclonedx/cdxgen']
              )
          ],
          [
            INLINED_SOCKET_CLI_HOMEPAGE,
            () => JSON.stringify(getRootPkgJsonSync().homepage)
          ],
          [
            INLINED_SOCKET_CLI_LEGACY_BUILD,
            () =>
              JSON.stringify(
                // Lazily access constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD].
                !!constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]
              )
          ],
          [
            INLINED_SOCKET_CLI_NAME,
            () => JSON.stringify(getRootPkgJsonSync().name)
          ],
          [
            INLINED_SOCKET_CLI_PUBLISHED_BUILD,
            () =>
              JSON.stringify(
                // Lazily access constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD].
                !!constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD]
              )
          ],
          [
            INLINED_SOCKET_CLI_SENTRY_BUILD,
            () =>
              JSON.stringify(
                // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
                !!constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
              )
          ],
          [
            INLINED_SOCKET_CLI_VERSION,
            () => JSON.stringify(getRootPkgJsonSync().version)
          ],
          [
            INLINED_SOCKET_CLI_VERSION_HASH,
            () => JSON.stringify(getSocketCliVersionHash())
          ],
          [
            INLINED_SYNP_VERSION,
            () => JSON.stringify(getRootPkgJsonSync().devDependencies['synp'])
          ],
          [
            VITEST,
            () =>
              // Lazily access constants.ENV[VITEST].
              !!constants.ENV[VITEST]
          ]
        ].reduce((obj, { 0: name, 1: value }) => {
          obj[`process.env.${name}`] = value
          obj[`process.env['${name}']`] = value
          obj[`process.env[${name}]`] = value
          return obj
        }, {})
      }),
      // Convert un-prefixed built-in imports into "node:"" prefixed forms.
      replacePlugin({
        delimiters: ['(?<=(?:require\\(|from\\s*)["\'])', '(?=["\'])'],
        preventAssignment: false,
        values: builtinAliases
      }),
      // Replace require calls to ESM 'tiny-colors' with CJS 'yoctocolors-cjs'
      // because we npm override 'tiny-colors' with 'yoctocolors-cjs' for dist
      // builds which causes 'tiny-colors' to be treated as an external, not bundled,
      // require.
      socketModifyPlugin({
        find: requireTinyColorsRegExp,
        replace: "require('yoctocolors-cjs')"
      }),
      // Try to convert `require('u' + 'rl')` into something like `require$$2$3`.
      socketModifyPlugin({
        find: splitUrlRequiresRegExp,
        replace(match) {
          return requireUrlAssignmentRegExp.exec(this.input)?.[0] ?? match
        }
      }),
      // Remove dangling require calls, e.g. require calls not associated with
      // an import binding:
      //   require('node:util')
      //   require('graceful-fs')
      socketModifyPlugin({
        find: danglingRequiresRegExp,
        replace: ''
      }),
      // Replace requires like require('blessed/lib/widgets/screen') with
      // require('../blessed/lib/widgets/screen').
      ...[/*'@socketsecurity/registry',*/ 'blessed', 'blessed-contrib'].map(n => {
        const requiresRegExp = new RegExp(
          `(?<=require\\(["'])${escapeRegExp(n)}(?:=(?:\\/[^"']+)?["']\\))`,
          'g'
        )
        return socketModifyPlugin({
          find: requiresRegExp,
          replace: id => `./${id}`
        })
      }),
      ...extendPlugins
    ]
  }

  const configOutputs = Array.isArray(config.output)
    ? config.output
    : config.output
      ? [config.output]
      : []

  const output = configOutputs.map(configOutput => {
    const o = {
      ...configOutput
    }
    if (!o.preserveModules) {
      o.chunkFileNames = '[name].js'
      o.manualChunks = id_ => {
        const id = normalizeId(id_)
        switch (id) {
          case constantsSrcPath:
            return CONSTANTS
          case shadowNpmBinSrcPath:
            return SHADOW_NPM_BIN
          case shadowNpmInjectSrcPath:
            return SHADOW_NPM_INJECT
          case shadowNpmPathsSrcPath:
            return SHADOW_NPM_PATHS
          default:
            return id.includes(SLASH_NODE_MODULES_SLASH) ? VENDOR : null
        }
      }
    }
    return o
  })

  config.output = output
  return config
}
