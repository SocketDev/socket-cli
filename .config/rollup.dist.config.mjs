import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'

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

const distModuleSyncPath = path.join(rootDistPath, 'module-sync')
const distRequirePath = path.join(rootDistPath, 'require')

const binBasenames = ['cli.js', 'npm-cli.js', 'npx-cli.js']
const editablePkgJson = readPackageJsonSync(rootPath, { editable: true })

function copyConstantsModuleSync(srcPath, destPath) {
  copyFileSync(
    path.join(srcPath, CONSTANTS_JS),
    path.join(destPath, CONSTANTS_JS)
  )
}

function modifyConstantsModuleExportsSync(distPath) {
  const filepath = path.join(distPath, CONSTANTS_JS)
  let code = readFileSync(filepath, 'utf8')
  code = code
    // Remove @babel/runtime helpers from code.
    .replace(
      /function getDefaultExportFromCjs[\s\S]+?constants\$\d+\.default = void 0;?\n/,
      ''
    )
    // Remove @babel/runtime and @rollup/commonjs interop from code.
    .replace(/^(?:exports.[$\w]+|[$\w]+\.default)\s*=.*(?:\n|$)/gm, '')
  code = code + 'module.exports = constants\n'
  writeFileSync(filepath, code, 'utf8')
}

function rewriteConstantsModuleSync(distPath) {
  writeFileSync(
    path.join(distPath, CONSTANTS_JS),
    `'use strict'\n\nmodule.exports = require('../constants.js')\n`,
    'utf8'
  )
}

function setBinPermsSync(distPath) {
  for (const binBasename of binBasenames) {
    // Make file chmod +x.
    chmodSync(path.join(distPath, binBasename), 0o755)
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
      'npm-cli': `${rootSrcPath}/shadow/npm-cli.ts`,
      'npx-cli': `${rootSrcPath}/shadow/npx-cli.ts`,
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
        writeBundle() {
          setBinPermsSync(distModuleSyncPath)
          copyConstantsModuleSync(distModuleSyncPath, rootDistPath)
          modifyConstantsModuleExportsSync(rootDistPath)
          rewriteConstantsModuleSync(distModuleSyncPath)
        }
      }
    ]
  })

  const requireConfig = baseConfig({
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      'npm-cli': `${rootSrcPath}/shadow/npm-cli.ts`,
      'npx-cli': `${rootSrcPath}/shadow/npx-cli.ts`,
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
        writeBundle() {
          setBinPermsSync(distRequirePath)
          rewriteConstantsModuleSync(distRequirePath)
          updateDepStatsSync(requireConfig.meta.depStats)
        }
      }
    ]
  })

  return [moduleSyncConfig, requireConfig]
}
