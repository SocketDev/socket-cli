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
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants from '../scripts/constants.mjs'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.mjs'
// Transform Ink to remove DEV mode block with top-level await
import transformInkPlugin from '../scripts/rollup/transform-ink-plugin.mjs'
import {
  getPackageName,
  isBuiltin,
  normalizeId,
} from '../scripts/utils/packages.mjs'

const {
  INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
  INLINED_SOCKET_CLI_HOMEPAGE,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_NAME,
  INLINED_SOCKET_CLI_PUBLISHED_BUILD,
  INLINED_SOCKET_CLI_PYTHON_BUILD_TAG,
  INLINED_SOCKET_CLI_PYTHON_VERSION,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INLINED_SOCKET_CLI_SYNP_VERSION,
  INLINED_SOCKET_CLI_VERSION,
  INLINED_SOCKET_CLI_VERSION_HASH,
  NODE_MODULES,
  ROLLUP_EXTERNAL_SUFFIX,
  UTF8,
  VITEST,
} = constants

export const EXTERNAL_PACKAGES = [
  '@socketsecurity/registry',
  '@socketsecurity/sdk',
]

const builtinAliases = builtinModules.reduce((o, n) => {
  if (!n.startsWith('node:')) {
    o[n] = `node:${n}`
  }
  return o
}, {})

let _rootPkgJson
function getRootPkgJsonSync() {
  if (_rootPkgJson === undefined) {
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
      gitHash = stripAnsi(
        spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
          encoding: UTF8,
        }).stdout.trim(),
      )
    } catch {}
    // Make each build generate a unique version id, regardless.
    // Mostly for development: confirms the build refreshed. For prod builds
    // the git hash should suffice to identify the build.
    _socketVersionHash = `${version}:${gitHash}:${randUuidSegment}${
      constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD] ? '' : ':dev'
    }`
  }
  return _socketVersionHash
}

const requiredToVarName = new Map()
function getVarNameForRequireId(filename, id, lookbehindContent) {
  const key = `${filename}:${id}`
  let varName = requiredToVarName.get(key)
  if (varName) {
    return varName
  }
  const varNameRegExp = new RegExp(
    `(?<=var +)[$\\w]+(?=\\s*=\\s*require[$\\w]*\\(["']${escapeRegExp(id)}["']\\))`,
  )
  varName = varNameRegExp.exec(lookbehindContent)?.[0] ?? ''
  if (varName) {
    requiredToVarName.set(key, varName)
  }
  return varName
}

export default function baseConfig(extendConfig = {}) {
  const { configPath, rootPath } = constants

  const nmPath = path.join(rootPath, NODE_MODULES)

  const extendPlugins = Array.isArray(extendConfig.plugins)
    ? extendConfig.plugins.slice()
    : []

  const extractedPlugins = Object.create(null)
  if (extendPlugins.length) {
    for (const pluginName of [
      'babel',
      'commonjs',
      'json',
      'node-resolve',
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
    // Disable tree-shaking to prevent incorrect removal of code.
    // Without this, Rollup may incorrectly remove code that appears unused
    // but is actually accessed dynamically or through other means.
    treeshake: false,
    external(rawId) {
      // Order checks by likelihood for better performance.
      // Externalize Node.js built-ins (most common case).
      if (isBuiltin(rawId)) {
        return true
      }
      // Externalize special rollup external suffix.
      if (rawId.endsWith(ROLLUP_EXTERNAL_SUFFIX)) {
        return true
      }
      const id = normalizeId(rawId)
      // Externalize anything from the external directory, except entry points.
      if (
        id.includes('/external/') &&
        !id.endsWith('/external/ink-table.mjs') &&
        !id.endsWith('/external/yoga-layout.mjs')
      ) {
        return true
      }
      // Externalize TypeScript declaration files.
      if (
        id.endsWith('.d.ts') ||
        id.endsWith('.d.mts') ||
        id.endsWith('.d.cts')
      ) {
        return true
      }
      const pkgName = getPackageName(
        id,
        path.isAbsolute(id) ? nmPath.length + 1 : 0,
      )
      // Externalize @socketsecurity/registry and all its internal paths.
      if (
        pkgName === '@socketsecurity/registry' ||
        id.includes('@socketsecurity/registry/external/') ||
        id.includes('/@socketsecurity+registry@')
      ) {
        return true
      }
      // Externalize @socketsecurity/sdk and all its internal paths.
      if (
        pkgName === '@socketsecurity/sdk' ||
        id.includes('/@socketsecurity+sdk@')
      ) {
        return true
      }
      // Externalize other specific external packages.
      return EXTERNAL_PACKAGES.includes(pkgName)
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
      // Resolve yoga-layout to our external wrapper
      {
        name: 'resolve-yoga-layout',
        resolveId(id) {
          if (id === 'yoga-layout') {
            return path.join(rootPath, 'src/external/yoga-layout.mjs')
          }
        },
      },
      // Transform Ink to remove DEV mode block with top-level await
      transformInkPlugin(),
      extractedPlugins['node-resolve'] ??
        nodeResolve({
          exportConditions: ['node'],
          extensions: ['.mjs', '.mts', '.js', '.ts', '.tsx', '.json'],
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
          extensions: ['.mjs', '.mts', '.js', '.ts', '.tsx'],
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
            INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
            () =>
              JSON.stringify(
                getRootPkgJsonSync().devDependencies['@coana-tech/cli'],
              ),
          ],
          [
            INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
            () =>
              JSON.stringify(
                getRootPkgJsonSync().devDependencies['@cyclonedx/cdxgen'],
              ),
          ],
          [INLINED_SOCKET_CLI_PYTHON_VERSION, () => JSON.stringify('3.10.18')],
          [
            INLINED_SOCKET_CLI_PYTHON_BUILD_TAG,
            () => JSON.stringify('20250918'),
          ],
          [
            INLINED_SOCKET_CLI_HOMEPAGE,
            () => JSON.stringify(getRootPkgJsonSync().homepage),
          ],
          [
            INLINED_SOCKET_CLI_LEGACY_BUILD,
            () =>
              JSON.stringify(!!constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]),
          ],
          [
            INLINED_SOCKET_CLI_NAME,
            () => JSON.stringify(getRootPkgJsonSync().name),
          ],
          [
            INLINED_SOCKET_CLI_PUBLISHED_BUILD,
            () =>
              JSON.stringify(
                !!constants.ENV[INLINED_SOCKET_CLI_PUBLISHED_BUILD],
              ),
          ],
          [
            INLINED_SOCKET_CLI_SENTRY_BUILD,
            () =>
              JSON.stringify(!!constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]),
          ],
          [
            INLINED_SOCKET_CLI_SYNP_VERSION,
            () => JSON.stringify(getRootPkgJsonSync().devDependencies['synp']),
          ],
          [
            INLINED_SOCKET_CLI_VERSION,
            () => JSON.stringify(getRootPkgJsonSync().version),
          ],
          [
            INLINED_SOCKET_CLI_VERSION_HASH,
            () => JSON.stringify(getSocketCliVersionHash()),
          ],
          [VITEST, () => !!constants.ENV[VITEST]],
        ].reduce((obj, { 0: name, 1: value }) => {
          obj[`process.env.${name}`] = value
          obj[`process.env['${name}']`] = value
          obj[`process.env[${name}]`] = value
          return obj
        }, {}),
      }),
      // Remove dangling require calls, e.g. require calls not associated with
      // an import binding:
      //   require('node:util')
      //   require('graceful-fs')
      socketModifyPlugin({
        find: /^\s*require[$\w]*\(["'].+?["']\);?\r?\n/gm,
        replace: '',
      }),
      // Replace require calls to ESM 'tiny-colors' with CJS 'yoctocolors-cjs'
      // because we npm override 'tiny-colors' with 'yoctocolors-cjs' for dist
      // builds which causes 'tiny-colors' to be treated as an external, not bundled,
      // require.
      socketModifyPlugin({
        find: /require[$\w]*\(["']tiny-colors["']\)/g,
        replace: "require('yoctocolors-cjs')",
      }),
      // Try to convert `require('u' + 'rl')` into something like `require$$2$3`.
      socketModifyPlugin({
        find: /require[$\w]*\(["']u["']\s*\+\s*["']rl["']\)/g,
        replace(match, index) {
          const { fileName } = this.chunk
          const beforeMatch = this.input.slice(0, index)
          return (
            getVarNameForRequireId(fileName, 'node:url', beforeMatch) || match
          )
        },
      }),
      // Convert un-prefixed built-in imports into "node:"" prefixed forms.
      replacePlugin({
        delimiters: ['(?<=(?:require[$\\w]*\\(|from\\s*)["\'])', '(?=["\'])'],
        preventAssignment: false,
        values: builtinAliases,
      }),
      // Reduce duplicate require('node:...') variable assignments.
      socketModifyPlugin({
        find: /var +([$\w]+)\s*=\s*require[$\w]*\(["'](node:.+?)["']\)/g,
        replace(match, currVarName, id, index) {
          const { fileName } = this.chunk
          const beforeMatch = this.input.slice(0, index)
          const prevVarName = getVarNameForRequireId(fileName, id, beforeMatch)
          return !prevVarName || currVarName === prevVarName
            ? match
            : `var ${currVarName} = ${prevVarName}`
        },
      }),
      ...extendPlugins,
    ],
  }
}
