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
import { readJsonSync } from '../scripts/utils/fs.js'
import { formatObject } from '../scripts/utils/objects.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId
} from '../scripts/utils/packages.js'

const {
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
    // Manually add @cyclonedx/cdxgen and synp as they are not directly
    // referenced in the code but used through spawned processes.
    '@cyclonedx/cdxgen': pkgJson.dependencies['@cyclonedx/cdxgen'],
    synp: pkgJson.dependencies.synp,
    // Assign old dep stats dependencies to preserve them.
    ...oldDepStats?.dependencies
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
        name === '@babel/runtime' ||
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
