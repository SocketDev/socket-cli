import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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
  CONSTANTS,
  MODULE_SYNC,
  REQUIRE,
  ROLLUP_EXTERNAL_SUFFIX,
  VENDOR,
  depStatsPath,
  rootDistPath,
  rootPath,
  rootSrcPath
} = constants

const CONSTANTS_JS = `${CONSTANTS}.js`
const CONSTANTS_STUB_CODE = createStubCode(`../${CONSTANTS_JS}`)
const VENDOR_JS = `${VENDOR}.js`

const distConstantsPath = path.join(rootDistPath, CONSTANTS_JS)
const distModuleSyncPath = path.join(rootDistPath, MODULE_SYNC)
const distRequirePath = path.join(rootDistPath, REQUIRE)

const editablePkgJson = readPackageJsonSync(rootPath, { editable: true })

const processEnvTapRegExp =
  /\bprocess\.env(?:\.TAP|\[['"]TAP['"]\])(\s*\?[^:]+:\s*)?/g

function createStubCode(relFilepath) {
  return `'use strict'\n\nmodule.exports = require('${relFilepath}')\n`
}

function moveDtsFilesSync(namePattern, srcPath, destPath) {
  for (const filepath of tinyGlobSync([`**/${namePattern}.d.ts{.map,}`], {
    absolute: true,
    cwd: srcPath
  })) {
    copyFileSync(filepath, path.join(destPath, path.basename(filepath)))
    rmSync(filepath)
  }
}

function copyInitGradle() {
  const filepath = path.join(rootSrcPath, 'commands', 'manifest', 'init.gradle')
  const destPath = path.join(rootDistPath, 'init.gradle')
  copyFileSync(filepath, destPath)
}

function removeDtsFilesSync(namePattern, srcPath) {
  for (const filepath of tinyGlobSync([`**/${namePattern}.d.ts{.map,}`], {
    absolute: true,
    cwd: srcPath
  })) {
    rmSync(filepath)
  }
}

function updateDepStatsSync(depStats) {
  const { content: pkgJson } = editablePkgJson
  const oldDepStats = existsSync(depStatsPath)
    ? readJsonSync(depStatsPath)
    : undefined
  Object.assign(depStats.dependencies,
    // Add existing package.json dependencies without old transitives. This
    // preserves dependencies like '@cyclonedx/cdxgen' and 'synp' that are
    // indirectly referenced through spawned processes and not directly imported.
    Object.fromEntries(
      Object.entries(pkgJson.dependencies).filter(
        ({ 0: key }) => !oldDepStats?.transitives?.[key]
      )
    ))
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
      {
        generateBundle(_options, bundle) {
          const data = bundle[CONSTANTS_JS]
          if (data?.type === 'chunk') {
            data.code = CONSTANTS_STUB_CODE
          }
        },
        writeBundle() {
          removeDtsFilesSync(CONSTANTS, distModuleSyncPath)
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
      // When process.env['TAP'] is found either remove it, if part of a ternary
      // operation, or replace it with `false`.
      socketModifyPlugin({
        find: processEnvTapRegExp,
        replace: (_match, ternary) => (ternary ? '' : 'false')
      }),
      {
        generateBundle(_options, bundle) {
          for (const basename of Object.keys(bundle)) {
            const data = bundle[basename]
            if (data.type === 'chunk') {
              if (basename === CONSTANTS_JS) {
                mkdirSync(rootDistPath, { recursive: true })
                writeFileSync(distConstantsPath, data.code, 'utf8')
                data.code = CONSTANTS_STUB_CODE
              } else if (
                basename !== VENDOR_JS &&
                !data.code.includes(`'./${VENDOR_JS}'`)
              ) {
                data.code = createStubCode(`../${MODULE_SYNC}/${basename}`)
              }
            }
          }
        },
        writeBundle() {
          moveDtsFilesSync(CONSTANTS, distRequirePath, rootDistPath)
          copyInitGradle()
          removeDtsFilesSync('*', distRequirePath)
          updateDepStatsSync(requireConfig.meta.depStats)
        }
      }
    ]
  })

  return [moduleSyncConfig, requireConfig]
}
