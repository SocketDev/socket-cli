import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import rangesIntersect from 'semver/ranges/intersects.js'
import { readPackageUpSync } from 'read-package-up'
import { purgePolyfills } from 'unplugin-purge-polyfills'

import {
  getPackageName,
  getPackageNameEnd,
  isEsmId,
  normalizeId,
  isPackageName,
  isBuiltin,
  readPackageJsonSync,
  resolveId
} from '../scripts/utils/packages.js'
import { escapeRegExp } from '../scripts/utils/regexps.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)

const ts = require('rollup-plugin-ts')

const ENTRY_SUFFIX = '?commonjs-entry'
const EXTERNAL_SUFFIX = '?commonjs-external'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'

const builtinAliases = builtinModules.reduce((o, n) => {
  o[n] = `node:${n}`
  return o
}, {})

const rootPath = path.resolve(__dirname, '..')
const babelConfigPath = path.join(__dirname, 'babel.config.js')
const tsconfigPath = path.join(__dirname, 'tsconfig.rollup.json')

const babelConfig = require(babelConfigPath)
const { dependencies: pkgDeps, devDependencies: pkgDevDeps } =
  readPackageJsonSync(rootPath)

const customResolver = nodeResolve({
  exportConditions: ['node'],
  preferBuiltins: true
})

export default (extendConfig = {}) => {
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
      if (id_.endsWith(EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      if (id.endsWith('.cjs')) {
        return true
      }
      if (id.endsWith('.mjs') || id.endsWith('.mts') || id.endsWith('.ts')) {
        return false
      }
      const parentId = parentId_ ? resolveId(parentId_) : undefined
      const resolvedId = resolveId(id, parentId)
      if (resolvedId.endsWith('.json')) {
        let currNmIndex = resolvedId.indexOf(SLASH_NODE_MODULES_SLASH)
        while (currNmIndex !== -1) {
          const nextNmIndex = resolvedId.indexOf(
            SLASH_NODE_MODULES_SLASH,
            currNmIndex + 1
          )
          const currPkgName = resolvedId.slice(
            currNmIndex + SLASH_NODE_MODULES_SLASH.length,
            nextNmIndex === -1 ? resolvedId.length : nextNmIndex
          )
          if (isEsmId(currPkgName, parentId)) {
            return false
          }
          currNmIndex = nextNmIndex
        }
        return true
      }
      if (!isPackageName(id)) {
        return false
      }
      const name = getPackageName(id)
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
          ''
        return false
      }
      const parentNodeModulesIndex = parentId.lastIndexOf('/node_modules/')
      if (parentNodeModulesIndex !== -1) {
        const parentNameStart = parentNodeModulesIndex + 14
        const parentNameEnd = getPackageNameEnd(parentId, parentNameStart)
        const {
          version,
          dependencies = {},
          optionalDependencies = {},
          peerDependencies = {}
        } = readPackageJsonSync(
          `${parentId.slice(0, parentNameEnd)}/package.json`
        )
        const curRange =
          dependencies[name] ??
          optionalDependencies[name] ??
          peerDependencies[name] ??
          version
        const seenRange = pkgDeps[name] ?? depStats.external[name]
        if (seenRange) {
          return rangesIntersect(seenRange, curRange)
        }
        depStats.external[name] = curRange
        depStats.transitives[name] = curRange
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
      json(),
      ts({
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
      // Convert un-prefixed built-in imports into "node:"" prefixed forms.
      replace({
        delimiters: ['(?<=(?:require\\(|from\\s*)["\'])', '(?=["\'])'],
        preventAssignment: false,
        values: builtinAliases
      }),
      // Convert `require('u' + 'rl')` into something like `require$$2$3`.
      socketModifyPlugin({
        find: /require\('u' \+ 'rl'\)/g,
        replace(match) {
          return (
            /(?<=var +)[$\w]+(?= *= *require\('node:url'\))/.exec(
              this.input
            )?.[0] ?? match
          )
        }
      }),
      // Remove bare require calls, e.g. require calls not associated with an
      // import binding:
      //   require('node:util')
      //   require('graceful-fs')
      socketModifyPlugin({
        find: /^\s*require\(["'].+?["']\);?\r?\n/gm,
        replace: ''
      }),
      // Fix incorrectly set "spinners" binding caused by a transpilation bug
      // https://github.com/sindresorhus/ora/blob/v8.1.0/index.js#L415
      // export {default as spinners} from 'cli-spinners'
      socketModifyPlugin({
        find: /(?<=ora[^.]+\.spinners\s*=\s*)[$\w]+/g,
        replace(match) {
          return (
            new RegExp(`(?<=${escapeRegExp(match)}\\s*=\\s*)[$\\w]+`).exec(
              this.input
            )?.[0] ?? match
          )
        }
      }),
      commonjs({
        ignoreDynamicRequires: true,
        ignoreGlobal: true,
        ignoreTryCatch: true,
        defaultIsModuleExports: true,
        strictRequires: 'auto',
        transformMixedEsModules: true,
        extensions: ['.cjs', '.js', '.ts', `.ts${ENTRY_SUFFIX}`]
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
    manualChunks(id) {
      if (id.includes('/node_modules/')) {
        return 'vendor'
      }
    }
  }))

  // Replace hard-coded absolute paths in source with hard-coded relative paths.
  const replacePlugin = replace({
    delimiters: ['(?<=["\'])', '/'],
    preventAssignment: false,
    values: {
      [rootPath]: '../'
    }
  })

  const replaceOutputPlugin = {
    name: replacePlugin.name,
    renderChunk: replacePlugin.renderChunk
  }

  for (const o of output) {
    o.plugins = [
      ...(Array.isArray(o.plugins) ? o.plugins : []),
      replaceOutputPlugin
    ]
  }

  config.output = output
  return config
}
