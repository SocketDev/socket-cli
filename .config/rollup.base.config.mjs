import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import { readPackageUpSync } from 'read-package-up'
import rangesIntersect from 'semver/ranges/intersects.js'
import { purgePolyfills } from 'unplugin-purge-polyfills'

import { isRelative } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import {
  isValidPackageName,
  readPackageJsonSync
} from '@socketsecurity/registry/lib/packages'

import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import {
  getPackageName,
  getPackageNameEnd,
  isEsmId,
  normalizeId,
  isBuiltin,
  resolveId
} from '../scripts/utils/packages.js'

const {
  LATEST,
  ROLLUP_ENTRY_SUFFIX,
  ROLLUP_EXTERNAL_SUFFIX,
  SLASH_NODE_MODULES_SLASH
} = constants

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)

const ts = require('rollup-plugin-ts')

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
      if (
        isRelative(id) ||
        id.startsWith('src/') ||
        id.endsWith('.mjs') ||
        id.endsWith('.mts')
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
      const name = getPackageName(id)
      if (name === '@babel/runtime' || !isValidPackageName(name)) {
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
      const parentNodeModulesIndex = parentId.lastIndexOf(
        SLASH_NODE_MODULES_SLASH
      )
      if (parentNodeModulesIndex !== -1) {
        const parentNameStart =
          parentNodeModulesIndex + SLASH_NODE_MODULES_SLASH.length
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
      // https://github.com/sindresorhus/ora/blob/v8.1.1/index.js#L424
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
        defaultIsModuleExports: true,
        extensions: ['.cjs', '.js', '.ts', `.ts${ROLLUP_ENTRY_SUFFIX}`],
        ignoreDynamicRequires: true,
        ignoreGlobal: true,
        ignoreTryCatch: true,
        strictRequires: 'auto',
        transformMixedEsModules: true
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
