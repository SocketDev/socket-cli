import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'

import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
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

const {
  BABEL_RUNTIME,
  LATEST,
  ROLLUP_ENTRY_SUFFIX,
  ROLLUP_EXTERNAL_SUFFIX,
  SLASH_NODE_MODULES_SLASH,
  babelConfigPath,
  rootPackageJsonPath,
  rootPath,
  rootSrcPath,
  tsconfigPath
} = constants

const require = createRequire(import.meta.url)

const tsPlugin = require('rollup-plugin-ts')

const rootPackageJson = require(rootPackageJsonPath)
const {
  dependencies: pkgDeps,
  devDependencies: pkgDevDeps,
  overrides: pkgOverrides
} = rootPackageJson

const SOCKET_INTEROP = '_socketInterop'

const constantsSrcPath = path.join(rootSrcPath, 'constants.ts')

const builtinAliases = builtinModules.reduce((o, n) => {
  o[n] = `node:${n}`
  return o
}, {})

const babelConfig = require(babelConfigPath)

const customResolver = nodeResolve({
  exportConditions: ['node'],
  preferBuiltins: true
})

const requireAssignmentsRegExp =
  /(?<=\s*=\s*)require\(["'](?!node:|@socket(?:registry|security)\/|\.).+?["']\)(?=;?\r?\n)/g
const checkRequireAssignmentRegExp = new RegExp(
  requireAssignmentsRegExp.source,
  ''
)
const checkSocketInteropUseRegExp = new RegExp(`\\b${SOCKET_INTEROP}\\b`)
const danglingRequiresRegExp = /^\s*require\(["'].+?["']\);?\r?\n/gm
const firstUseStrictRegExp = /'use strict';?/
const oraSpinnersAssignmentsRegExp = /(?<=ora[^.]+\.spinners\s*=\s*)[$\w]+/g
const requireTinyColorsRegExp = /require\(["']tiny-colors["']\)/g
const requireUrlAssignmentRegExp =
  /(?<=var +)[$\w]+(?= *= *require\('node:url'\))/
const splitUrlRequiresRegExp = /require\(["']u["']\s*\+\s*["']rl["']\)/g

function isAncestorsExternal(id, depStats) {
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
    if (isEsmId(nameSlashFilename, id)) {
      return false
    }
    const {
      version,
      dependencies = {},
      optionalDependencies = {},
      peerDependencies = {}
    } = readPackageJsonSync(`${id.slice(0, nameEnd)}/package.json`)
    const range =
      dependencies[name] ??
      optionalDependencies[name] ??
      peerDependencies[name] ??
      version
    const seenRange = pkgDeps[name] ?? depStats.external[name]
    if (seenRange && !rangesIntersect(seenRange, range)) {
      return false
    }
    currNmIndex = nextNmIndex
  }
  return true
}

export default function baseConfig(extendConfig = {}) {
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
      if (pkgOverrides[name] || isBlessedPackageName(name)) {
        return true
      }
      if (
        name === BABEL_RUNTIME ||
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
          version,
          dependencies = {},
          optionalDependencies = {},
          peerDependencies = {}
        } = readPackageJsonSync(
          `${parentId.slice(0, parentNameEnd)}/package.json`
        )
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
        tsconfig: tsconfigPath
      }),
      purgePolyfills.rollup({
        replacements: {}
      }),
      replacePlugin({
        delimiters: ['(?<=(?:require\\(|from\\s*)["\'])', '(?=["\'])'],
        preventAssignment: false,
        values: builtinAliases
      }),
      // Convert un-prefixed built-in imports into "node:"" prefixed forms.
      replacePlugin({
        delimiters: ['(?<=(?:require\\(|from\\s*)["\'])', '(?=["\'])'],
        preventAssignment: false,
        values: builtinAliases
      }),
      // Replace ESM package require('tiny-colors') with CJS package require('yoctocolors-cjs').
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
      // Fix incorrectly set "spinners" binding caused by a transpilation bug
      // https://github.com/sindresorhus/ora/blob/v8.1.1/index.js#L424
      // export {default as spinners} from 'cli-spinners'
      socketModifyPlugin({
        find: oraSpinnersAssignmentsRegExp,
        replace(match) {
          return (
            new RegExp(`(?<=${escapeRegExp(match)}\\s*=\\s*)[$\\w]+`).exec(
              this.input
            )?.[0] ?? match
          )
        }
      }),
      commonjsPlugin({
        defaultIsModuleExports: true,
        extensions: ['.cjs', '.js', '.ts', `.ts${ROLLUP_ENTRY_SUFFIX}`],
        ignoreDynamicRequires: true,
        ignoreGlobal: true,
        ignoreTryCatch: true,
        strictRequires: 'auto'
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
      if (id === constantsSrcPath) {
        return 'constants'
      }
      if (id.includes(SLASH_NODE_MODULES_SLASH)) {
        return 'vendor'
      }
      return null
    }
  }))

  // Replace hard-coded absolute paths in source with hard-coded relative paths.
  const replaceAbsPathsOutputPlugin = (() => {
    const { name, renderChunk } = replacePlugin({
      delimiters: ['(?<=["\'])', '/'],
      preventAssignment: false,
      values: {
        [rootPath]: '../../'
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
