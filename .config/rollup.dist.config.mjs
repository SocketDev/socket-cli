import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { globSync as tinyGlobSync } from 'tinyglobby'

import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import {
  isValidPackageName,
  readPackageJsonSync
} from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'

import baseConfig from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import { readJsonSync } from '../scripts/utils/fs.js'
import { formatObject } from '../scripts/utils/objects.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId
} from '../scripts/utils/packages.js'

const {
  BABEL_RUNTIME,
  ROLLUP_EXTERNAL_SUFFIX,
  depStatsPath,
  rootDistPath,
  rootPath,
  rootSrcPath
} = constants

const CONSTANTS_JS = 'constants.js'
const CONSTANTS_STUB_CODE = `'use strict'\n\nmodule.exports = require('../${CONSTANTS_JS}')\n`

const distConstantsPath = path.join(rootDistPath, CONSTANTS_JS)
const distModuleSyncPath = path.join(rootDistPath, 'module-sync')
const distRequirePath = path.join(rootDistPath, 'require')

const editablePkgJson = readPackageJsonSync(rootPath, { editable: true })

const processEnvTapRegExp =
  /\bprocess\.env(?:\.TAP|\[['"]TAP['"]\])(\s*\?[^:]+:\s*)?/g

function removeDtsFilesSync(distPath) {
  for (const filepath of tinyGlobSync(['**/*.d.ts'], {
    absolute: true,
    cwd: distPath
  })) {
    rmSync(filepath)
  }
}

function updateDepStatsSync(depStats) {
  const { content: pkgJson } = editablePkgJson
  const oldDepStats = existsSync(depStatsPath)
    ? readJsonSync(depStatsPath)
    : undefined
  Object.assign(depStats.dependencies, {
    // Add existing package.json dependencies without old transitives. This
    // preserves dependencies like '@cyclonedx/cdxgen' and 'synp' that are
    // indirectly referenced through spawned processes and not directly imported.
    ...Object.fromEntries(
      Object.entries(pkgJson.dependencies).filter(
        ({ 0: key }) => !oldDepStats?.transitives?.[key]
      )
    )
  })
  // Remove transitives from dependencies.
  for (const key of Object.keys(oldDepStats?.transitives ?? {})) {
    if (pkgJson.dependencies[key]) {
      depStats.transitives[key] = pkgJson.dependencies[key]
      depStats.external[key] = pkgJson.dependencies[key]
      delete depStats.dependencies[key]
    }
  }
  depStats.dependencies = toSortedObject(depStats.dependencies)
  depStats.devDependencies = toSortedObject(depStats.devDependencies)
  depStats.esm = toSortedObject(depStats.esm)
  depStats.external = toSortedObject(depStats.external)
  depStats.transitives = toSortedObject(depStats.transitives)
  // Write dep stats.
  writeFileSync(depStatsPath, `${formatObject(depStats)}\n`, 'utf8')
  // Update dependencies with additional inlined modules.
  editablePkgJson
    .update({
      dependencies: {
        ...depStats.dependencies,
        ...depStats.transitives
      }
    })
    .saveSync()
}

export default () => {
  const moduleSyncConfig = baseConfig({
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      constants: `${rootSrcPath}/constants.ts`,
      'shadow-bin': `${rootSrcPath}/shadow/shadow-bin.ts`,
      'npm-injection': `${rootSrcPath}/shadow/npm-injection.ts`
    },
    output: [
      {
        dir: path.relative(rootPath, distModuleSyncPath),
        entryFileNames: '[name].js',
        exports: 'auto',
        externalLiveBindings: false,
        format: 'cjs',
        freeze: false
      }
    ],
    external(id_) {
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      const name = getPackageName(id)
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
      return true
    },
    plugins: [
      // When process.env['TAP'] is found either remove it, if part of a ternary
      // operation, or replace it with `false`.
      socketModifyPlugin({
        find: processEnvTapRegExp,
        replace: (match, ternary) => (ternary ? '' : 'false')
      }),
      {
        generateBundle(_options, bundle) {
          const constantsBundle = bundle[CONSTANTS_JS]
          if (constantsBundle) {
            mkdirSync(rootDistPath, { recursive: true })
            writeFileSync(distConstantsPath, constantsBundle.code, 'utf8')
            bundle[CONSTANTS_JS].code = CONSTANTS_STUB_CODE
          }
        }
      }
    ]
  })

  const requireConfig = baseConfig({
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      constants: `${rootSrcPath}/constants.ts`,
      'shadow-bin': `${rootSrcPath}/shadow/shadow-bin.ts`,
      'npm-injection': `${rootSrcPath}/shadow/npm-injection.ts`
    },
    output: [
      {
        dir: path.relative(rootPath, distRequirePath),
        entryFileNames: '[name].js',
        exports: 'auto',
        externalLiveBindings: false,
        format: 'cjs',
        freeze: false
      }
    ],
    plugins: [
      {
        generateBundle(_options, bundle) {
          if (bundle[CONSTANTS_JS]) {
            bundle[CONSTANTS_JS].code = CONSTANTS_STUB_CODE
          }
        },
        writeBundle() {
          removeDtsFilesSync(distRequirePath)
          updateDepStatsSync(requireConfig.meta.depStats)
        }
      }
    ]
  })

  return [moduleSyncConfig, requireConfig]
}
