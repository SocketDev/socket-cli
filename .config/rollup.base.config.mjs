import { randomUUID } from 'node:crypto'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'

import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
import MagicString from 'magic-string'
import { readPackageUpSync } from 'read-package-up'
import rangesIntersect from 'semver/ranges/intersects.js'
import { purgePolyfills } from 'unplugin-purge-polyfills'

import {
  isBlessedPackageName,
  isValidPackageName,
  readPackageJsonSync
} from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import {
  getPackageName,
  getPackageNameEnd,
  isBuiltin,
  isEsmId,
  normalizeId,
  resolveId
} from '../scripts/utils/packages.js'

const require = createRequire(import.meta.url)

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
  LATEST,
  ROLLUP_ENTRY_SUFFIX,
  ROLLUP_EXTERNAL_SUFFIX,
  SHADOW_NPM_BIN,
  SHADOW_NPM_INJECT,
  SHADOW_NPM_PATHS,
  SLASH_NODE_MODULES_SLASH,
  VENDOR,
  VITEST
} = constants

export const EXTERNAL_PACKAGES = ['blessed']

export const INLINED_PACKAGES = [
  '@babel/runtime',
  // 'blessed-contrib',
  // // 'blessed-contrib' package dependencies.
  // 'ansi-escapes',
  // 'ansi-regex',
  // 'bresenham',
  // 'buffers',
  // 'cardinal',
  // 'chalk',
  // 'charm',
  // 'cli-table3',
  // 'drawille-blessed-contrib',
  // 'drawille-canvas-blessed-contrib',
  // 'esprima',
  // 'event-stream',
  // 'gl-matrix',
  // 'has-flag',
  // 'node-emoji',
  // 'png-js',
  // 'readable-stream',
  // 'supports-hyperlinks',
  // 'x256'
]

const SOCKET_INTEROP = '_socketInterop'

const builtinAliases = builtinModules.reduce((o, n) => {
  o[n] = `node:${n}`
  return o
}, {})

const customResolver = nodeResolve({
  exportConditions: ['node'],
  preferBuiltins: true
})

const requireAssignmentsRegExp =
  /(?<=\s*=\s*)require\(["'](?!node:|@socket(?:override|registry|security)\/|\.).+?["']\)(?=;?\r?\n)/g

const checkRequireAssignmentRegExp = new RegExp(
  requireAssignmentsRegExp.source,
  ''
)

const checkSocketInteropUseRegExp = new RegExp(`\\b${SOCKET_INTEROP}\\b`)

const danglingRequiresRegExp = /^\s*require\(["'].+?["']\);?\r?\n/gm

const firstUseStrictRegExp = /'use strict';?/

const requireTinyColorsRegExp = /require\(["']tiny-colors["']\)/g

const blessedRequiresRegExp = /(?<=require\(["'])blessed(?:\/[^"']+)?(?=["']\))/g

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

function isAncestorsExternal(id, depStats) {
  // Lazily access constants.rootPackageJsonPath.
  const { dependencies: rootPkgDeps } = require(constants.rootPackageJsonPath)
  let currNmIndex = id.indexOf(SLASH_NODE_MODULES_SLASH)
  while (currNmIndex !== -1) {
    const nextNmIndex = id.indexOf(SLASH_NODE_MODULES_SLASH, currNmIndex + 1)
    const nameStart = currNmIndex + SLASH_NODE_MODULES_SLASH.length
    const nameEnd = getPackageNameEnd(id, nameStart)
    const name = id.slice(nameStart, nameEnd)
    const nameSlashFilename = id.slice(
      currNmIndex + SLASH_NODE_MODULES_SLASH.length,
      nextNmIndex === -1 ? id.length : nextNmIndex
    )
    if (INLINED_PACKAGES.includes(name) || isEsmId(nameSlashFilename, id)) {
      return false
    }
    const {
      dependencies = {},
      optionalDependencies = {},
      peerDependencies = {},
      version
    } = readPackageJsonSync(id.slice(0, nameEnd))
    const range =
      dependencies[name] ??
      optionalDependencies[name] ??
      peerDependencies[name] ??
      version
    const seenRange = rootPkgDeps[name] ?? depStats.external[name]
    if (seenRange && !rangesIntersect(seenRange, range)) {
      return false
    }
    currNmIndex = nextNmIndex
  }
  return true
}

export default function baseConfig(extendConfig = {}) {
  // Lazily access constants.rootSrcPath.
  const { rootSrcPath } = constants
  const {
    dependencies: pkgDeps,
    devDependencies: pkgDevDeps,
    overrides: pkgOverrides
    // Lazily access constants.rootPackageJsonPath.
  } = require(constants.rootPackageJsonPath)

  const constantsSrcPath = path.join(rootSrcPath, `constants.ts`)
  const shadowNpmBinSrcPath = path.join(rootSrcPath, 'shadow/npm/bin.ts')
  const shadowNpmInjectSrcPath = path.join(rootSrcPath, 'shadow/npm/inject.ts')
  const shadowNpmPathsSrcPath = path.join(rootSrcPath, 'shadow/npm/paths.ts')

  // Lazily access constants.babelConfigPath.
  const babelConfig = require(constants.babelConfigPath)
  const tsPlugin = require('rollup-plugin-ts')

  const depStats = {
    dependencies: { __proto__: null },
    devDependencies: { __proto__: null },
    esm: { __proto__: null },
    external: { __proto__: null },
    transitives: { __proto__: null }
  }

  const config = {
    __proto__: {
      meta: {
        depStats
      }
    },
    external(id_, parentId_) {
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      const name = getPackageName(id)
      if (
        pkgOverrides[name] ||
        isBlessedPackageName(name) ||
        EXTERNAL_PACKAGES.includes(name)
      ) {
        return true
      }
      if (
        INLINED_PACKAGES.includes(name) ||
        id.startsWith(rootSrcPath) ||
        id.endsWith('.mjs') ||
        id.endsWith('.mts') ||
        isRelative(id) ||
        !isValidPackageName(name)
      ) {
        return false
      }
      const parentId = parentId_ ? resolveId(parentId_) : undefined
      if (parentId && !isAncestorsExternal(parentId, depStats)) {
        return false
      }
      const resolvedId = resolveId(id, parentId)
      if (!isAncestorsExternal(resolvedId, depStats)) {
        return false
      }
      if (isEsmId(resolvedId, parentId)) {
        const parentPkg = parentId
          ? readPackageUpSync({ cwd: path.dirname(parentId) })?.packageJson
          : undefined
        depStats.esm[name] =
          pkgDeps[name] ??
          pkgDevDeps[name] ??
          parentPkg?.dependencies?.[name] ??
          parentPkg?.optionalDependencies?.[name] ??
          parentPkg?.peerDependencies?.[name] ??
          readPackageUpSync({ cwd: path.dirname(resolvedId) })?.packageJson
            ?.version ??
          LATEST
        return false
      }
      const parentNmIndex = parentId.lastIndexOf(SLASH_NODE_MODULES_SLASH)
      if (parentNmIndex !== -1) {
        const parentNameStart = parentNmIndex + SLASH_NODE_MODULES_SLASH.length
        const parentNameEnd = getPackageNameEnd(parentId, parentNameStart)
        const {
          dependencies = {},
          optionalDependencies = {},
          peerDependencies = {},
          version
        } = readPackageJsonSync(parentId.slice(0, parentNameEnd))
        const range =
          dependencies[name] ??
          optionalDependencies[name] ??
          peerDependencies[name] ??
          version
        const seenRange = pkgDeps[name] ?? depStats.external[name]
        if (seenRange) {
          return rangesIntersect(seenRange, range)
        }
        depStats.external[name] = range
        depStats.transitives[name] = range
      } else if (pkgDeps[name]) {
        depStats.external[name] = pkgDeps[name]
        depStats.dependencies[name] = pkgDeps[name]
      } else if (pkgDevDeps[name]) {
        depStats.devDependencies[name] = pkgDevDeps[name]
      }
      return true
    },
    onwarn(warning, warn) {
      // Suppress THIS_IS_UNDEFINED warnings.
      if (warning.code === 'THIS_IS_UNDEFINED') {
        return
      }
      // Forward other warnings.
      warn(warning)
    },
    ...extendConfig,
    plugins: [
      customResolver,
      jsonPlugin(),
      tsPlugin({
        transpiler: 'babel',
        browserslist: false,
        transpileOnly: true,
        exclude: ['**/*.json'],
        babelConfig,
        // Lazily access constants.tsconfigPath.
        tsconfig: constants.tsconfigPath
      }),
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
      // Replace require('blessed/lib/widgets/xyz') with require('../blessed/lib/widgets/xyz').
      // socketModifyPlugin({
      //   find: blessedRequiresRegExp,
      //   replace: (id) => `../${id}`
      // }),
      commonjsPlugin({
        defaultIsModuleExports: true,
        extensions: ['.cjs', '.js', '.ts', `.ts${ROLLUP_ENTRY_SUFFIX}`],
        ignoreDynamicRequires: true,
        ignoreGlobal: true,
        ignoreTryCatch: true,
        strictRequires: true
      }),
      // Wrap require calls with SOCKET_INTEROP helper.
      socketModifyPlugin({
        find: requireAssignmentsRegExp,
        replace: match => `${SOCKET_INTEROP}(${match})`
      }),
      // Add CJS interop helper for "default" only exports.
      socketModifyPlugin({
        find: firstUseStrictRegExp,
        replace(match) {
          return checkRequireAssignmentRegExp.test(this.input) ||
            checkSocketInteropUseRegExp.test(this.input)
            ? `${match}\n
function ${SOCKET_INTEROP}(e) {
  let c = 0
  for (const k in e ?? {}) {
    c = c === 0 && k === 'default' ? 1 : 0
    if (!c && k !== '__esModule') break
  }
  return c ? e.default : e
}`
            : match
        }
      }),
      ...(extendConfig.plugins ?? [])
    ]
  }

  const output = (
    Array.isArray(config.output)
      ? config.output
      : config.output
        ? [config.output]
        : []
  ).map(o => ({
    ...o,
    chunkFileNames: '[name].js',
    manualChunks: id_ => {
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
        default: {
          return id.includes(SLASH_NODE_MODULES_SLASH) ? VENDOR : null
        }
      }
    }
  }))

  // Replace hard-coded absolute paths in source with hard-coded relative paths.
  const replaceAbsPathsOutputPlugin = (() => {
    const { name, renderChunk } = replacePlugin({
      delimiters: ['(?<=["\'])', '/'],
      preventAssignment: false,
      values: {
        // Lazily access constants.rootPath.
        [constants.rootPath]: '../../'
      }
    })
    return { name, renderChunk }
  })()

  for (const o of output) {
    o.plugins = [
      ...(Array.isArray(o.plugins) ? o.plugins : []),
      replaceAbsPathsOutputPlugin
    ]
  }

  config.output = output
  return config
}
