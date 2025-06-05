import { randomUUID } from 'node:crypto'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
import { purgePolyfills } from 'unplugin-purge-polyfills'

import { readPackageJsonSync } from '@socketsecurity/registry/lib/packages'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId,
} from '../scripts/utils/packages.js'

const {
  INLINED_CYCLONEDX_CDXGEN_VERSION,
  INLINED_SOCKET_CLI_HOMEPAGE,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_NAME,
  INLINED_SOCKET_CLI_PUBLISHED_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INLINED_SOCKET_CLI_VERSION,
  INLINED_SOCKET_CLI_VERSION_HASH,
  INLINED_SYNP_VERSION,
  NODE_MODULES,
  ROLLUP_EXTERNAL_SUFFIX,
  VITEST,
} = constants

export const EXTERNAL_PACKAGES = [
  '@coana-tech/cli',
  '@socketsecurity/registry',
  'blessed',
  'blessed-contrib',
]

const builtinAliases = builtinModules.reduce((o, n) => {
  o[n] = `node:${n}`
  return o
}, {})

let _rootPkgJson
function getRootPkgJsonSync() {
  if (_rootPkgJson === undefined) {
    // Lazily access constants.rootPath.
    _rootPkgJson = readPackageJsonSync(constants.rootPath, { normalize: true })
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
        encoding: 'utf8',
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
  // Lazily access constants path properties.
  const { configPath, rootPath } = constants
  const nmPath = path.join(rootPath, NODE_MODULES)
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
      'unplugin-purge-polyfills',
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

  return {
    external(rawId) {
      const id = normalizeId(rawId)
      const pkgName = getPackageName(
        id,
        path.isAbsolute(id) ? nmPath.length + 1 : 0,
      )
      return (
        id.endsWith('.d.cts') ||
        id.endsWith('.d.mts') ||
        id.endsWith('.d.ts') ||
        EXTERNAL_PACKAGES.includes(pkgName) ||
        rawId.endsWith(ROLLUP_EXTERNAL_SUFFIX) ||
        isBuiltin(rawId)
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
          extensions: ['.mjs', '.js', '.json', '.ts', '.mts'],
          preferBuiltins: true,
        }),
      extractedPlugins['json'] ?? jsonPlugin(),
      extractedPlugins['commonjs'] ??
        commonjsPlugin({
          defaultIsModuleExports: true,
          extensions: ['.cjs', '.js'],
          ignoreDynamicRequires: true,
          ignoreGlobal: true,
          ignoreTryCatch: true,
          strictRequires: true,
        }),
      extractedPlugins['babel'] ??
        babelPlugin({
          babelHelpers: 'runtime',
          babelrc: false,
          configFile: path.join(configPath, 'babel.config.js'),
          extensions: ['.mjs', '.js', '.ts', '.mts'],
        }),
      extractedPlugins['unplugin-purge-polyfills'] ??
        purgePolyfills.rollup({
          replacements: {},
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
                getRootPkgJsonSync().devDependencies['@cyclonedx/cdxgen'],
              ),
          ],
          [
            INLINED_SOCKET_CLI_HOMEPAGE,
            () => JSON.stringify(getRootPkgJsonSync().homepage),
          ],
          [
            INLINED_SOCKET_CLI_LEGACY_BUILD,
            () =>
              JSON.stringify(
                // Lazily access constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD].
                !!constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD],
              ),
          ],
          [
            INLINED_SOCKET_CLI_NAME,
            () => JSON.stringify(getRootPkgJsonSync().name),
          ],
          [
            INLINED_SOCKET_CLI_PUBLISHED_BUILD,
            () =>
              JSON.stringify(
                // Lazily access constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD].
                !!constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD],
              ),
          ],
          [
            INLINED_SOCKET_CLI_SENTRY_BUILD,
            () =>
              JSON.stringify(
                // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
                !!constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD],
              ),
          ],
          [
            INLINED_SOCKET_CLI_VERSION,
            () => JSON.stringify(getRootPkgJsonSync().version),
          ],
          [
            INLINED_SOCKET_CLI_VERSION_HASH,
            () => JSON.stringify(getSocketCliVersionHash()),
          ],
          [
            INLINED_SYNP_VERSION,
            () => JSON.stringify(getRootPkgJsonSync().devDependencies['synp']),
          ],
          [
            VITEST,
            () =>
              // Lazily access constants.ENV[VITEST].
              !!constants.ENV[VITEST],
          ],
        ].reduce((obj, { 0: name, 1: value }) => {
          obj[`process.env.${name}`] = value
          obj[`process.env['${name}']`] = value
          obj[`process.env[${name}]`] = value
          return obj
        }, {}),
      }),
      // Convert un-prefixed built-in imports into "node:"" prefixed forms.
      replacePlugin({
        delimiters: [
          '(?<=(?:require(?:\\$+\\d+)?\\(|from\\s*)["\'])',
          '(?=["\'])',
        ],
        preventAssignment: false,
        values: builtinAliases,
      }),
      // Replace require calls to ESM 'tiny-colors' with CJS 'yoctocolors-cjs'
      // because we npm override 'tiny-colors' with 'yoctocolors-cjs' for dist
      // builds which causes 'tiny-colors' to be treated as an external, not bundled,
      // require.
      socketModifyPlugin({
        find: /require(?:\$+\d+)?\(["']tiny-colors["']\)/g,
        replace: "require('yoctocolors-cjs')",
      }),
      // Try to convert `require('u' + 'rl')` into something like `require$$2$3`.
      socketModifyPlugin({
        find: /require(?:\$+\d+)?\(["']u["']\s*\+\s*["']rl["']\)/g,
        replace(match) {
          return (
            /(?<=var +)[$\w]+(?=\s*=\s*require(?:\$+\d+)?\(["']node:url["']\))/.exec(
              this.input,
            )?.[0] ?? match
          )
        },
      }),
      // Remove dangling require calls, e.g. require calls not associated with
      // an import binding:
      //   require('node:util')
      //   require('graceful-fs')
      socketModifyPlugin({
        find: /^\s*require(?:\$+\d+)?\(["'].+?["']\);?\r?\n/gm,
        replace: '',
      }),
      ...extendPlugins,
    ],
  }
}
