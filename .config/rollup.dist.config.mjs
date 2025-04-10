import assert from 'node:assert'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import replacePlugin from '@rollup/plugin-replace'
import { glob as tinyGlob } from 'tinyglobby'

import { readJson, writeJson } from '@socketsecurity/registry/lib/fs'
import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackageManifest,
  isValidPackageName,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import baseConfig, {
  EXTERNAL_PACKAGES,
  INLINED_PACKAGES
} from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import {
  getPackageName,
  getPackageNameEnd,
  isBuiltin,
  normalizeId,
  resolveId
} from '../scripts/utils/packages.js'

const {
  CONSTANTS,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INLINED_SOCKET_CLI_TEST_DIST_BUILD,
  INSTRUMENT_WITH_SENTRY,
  MODULE_SYNC,
  REQUIRE,
  ROLLUP_EXTERNAL_SUFFIX,
  SHADOW_NPM_BIN,
  SHADOW_NPM_INJECT,
  SLASH_NODE_MODULES_SLASH,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_BIN_NAME_ALIAS,
  SOCKET_CLI_LEGACY_PACKAGE_NAME,
  SOCKET_CLI_NPM_BIN_NAME,
  SOCKET_CLI_NPX_BIN_NAME,
  SOCKET_CLI_PACKAGE_NAME,
  SOCKET_CLI_SENTRY_BIN_NAME,
  SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
  SOCKET_CLI_SENTRY_NPM_BIN_NAME,
  SOCKET_CLI_SENTRY_NPX_BIN_NAME,
  SOCKET_CLI_SENTRY_PACKAGE_NAME,
  VENDOR,
  depStatsPath,
  rootDistPath,
  rootPackageLockPath,
  rootPath,
  rootSrcPath
} = constants

const SENTRY_NODE = '@sentry/node'
const SOCKET_DESCRIPTION = 'CLI tool for Socket.dev'
const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling, otherwise identical to the regular \`${SOCKET_CLI_BIN_NAME}\` package`
const VENDOR_JS = `${VENDOR}.js`

const distModuleSyncPath = path.join(rootDistPath, MODULE_SYNC)
const distRequirePath = path.join(rootDistPath, REQUIRE)

const sharedInputs = {
  cli: `${rootSrcPath}/cli.ts`,
  [CONSTANTS]: `${rootSrcPath}/constants.ts`,
  [SHADOW_NPM_BIN]: `${rootSrcPath}/shadow/npm/bin.ts`,
  [SHADOW_NPM_INJECT]: `${rootSrcPath}/shadow/npm/inject.ts`
}

const sharedOutputs = {
  entryFileNames: '[name].js',
  exports: 'auto',
  externalLiveBindings: false,
  format: 'cjs',
  freeze: false,
  sourcemap: true,
  sourcemapDebugIds: true
}

const sharedPlugins = [
  // Inline process.env values.
  replacePlugin({
    delimiters: ['(?<![\'"])\\b', '(?![\'"])'],
    preventAssignment: true,
    values: [[INLINED_SOCKET_CLI_TEST_DIST_BUILD, 'false']].reduce(
      (obj, { 0: name, 1: value }) => {
        obj[`process.env.${name}`] = value
        obj[`process.env['${name}']`] = value
        obj[`process.env[${name}]`] = value
        return obj
      },
      {}
    )
  })
]

async function copyBlessedWidgets() {
  // Copy blessed package files to dist.
  const blessedDestPath = path.join(rootDistPath, 'blessed')
  const blessedNmPath = path.join(rootPath, 'node_modules/blessed')
  const folders = ['lib', 'usr', 'vendor']
  await Promise.all(
    folders.map(f =>
      fs.cp(path.join(blessedNmPath, f), path.join(blessedDestPath, f), {
        recursive: true
      })
    )
  )
  // Add 'use strict' directive to js files.
  const jsFiles = await tinyGlob(['**/*.js'], {
    absolute: true,
    cwd: blessedDestPath
  })
  await Promise.all(
    jsFiles.map(async p => {
      const content = await fs.readFile(p, 'utf8')
      await fs.writeFile(p, `'use strict'\n\n${content}`, 'utf8')
    })
  )
}

async function copyInitGradle() {
  const filepath = path.join(rootSrcPath, 'commands/manifest/init.gradle')
  const destPath = path.join(rootDistPath, 'init.gradle')
  await fs.copyFile(filepath, destPath)
}

function createStubCode(relFilepath) {
  return `'use strict'\n\nmodule.exports = require('${relFilepath}')\n`
}

let _sentryManifest
async function getSentryManifest() {
  if (_sentryManifest === undefined) {
    _sentryManifest = await fetchPackageManifest(`${SENTRY_NODE}@latest`)
  }
  return _sentryManifest
}

async function globDtsAndMapFiles(namePattern, srcPath) {
  return await tinyGlob([`**/${namePattern}{.d.ts{.map,},.js.map}`], {
    absolute: true,
    cwd: srcPath
  })
}

async function globJsFiles(namePattern, srcPath) {
  return await tinyGlob([`**/${namePattern}.js`], {
    absolute: true,
    cwd: srcPath
  })
}

function isAncestorsExternal(id) {
  let currNmIndex = id.indexOf(SLASH_NODE_MODULES_SLASH)
  while (currNmIndex !== -1) {
    const nextNmIndex = id.indexOf(SLASH_NODE_MODULES_SLASH, currNmIndex + 1)
    const nameStart = currNmIndex + SLASH_NODE_MODULES_SLASH.length
    const nameEnd = getPackageNameEnd(id, nameStart)
    const name = id.slice(nameStart, nameEnd)
    if (INLINED_PACKAGES.includes(name)) {
      return false
    }
    currNmIndex = nextNmIndex
  }
  return true
}

async function moveDtsAndMapFiles(namePattern, srcPath, destPath) {
  await Promise.all(
    (await globDtsAndMapFiles(namePattern, srcPath)).map(p =>
      fs.rename(p, path.join(destPath, path.basename(p)))
    )
  )
}

async function moveJsFiles(namePattern, srcPath, destPath) {
  await Promise.all(
    (await globJsFiles(namePattern, srcPath)).map(p =>
      fs.rename(p, path.join(destPath, path.basename(p)))
    )
  )
}

async function removeDtsAndMapFiles(namePattern, srcPath) {
  await Promise.all(
    (await globDtsAndMapFiles(namePattern, srcPath)).map(p => fs.rm(p))
  )
}

async function removeJsFiles(namePattern, srcPath) {
  await Promise.all(
    (await globJsFiles(namePattern, srcPath)).map(p => fs.rm(p))
  )
}

function resetBin(bin) {
  const tmpBin = {
    [SOCKET_CLI_BIN_NAME]:
      bin?.[SOCKET_CLI_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_BIN_NAME],
    [SOCKET_CLI_NPM_BIN_NAME]:
      bin?.[SOCKET_CLI_NPM_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_NPM_BIN_NAME],
    [SOCKET_CLI_NPX_BIN_NAME]:
      bin?.[SOCKET_CLI_NPX_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_NPX_BIN_NAME]
  }
  const newBin = {
    ...(tmpBin[SOCKET_CLI_BIN_NAME]
      ? { [SOCKET_CLI_BIN_NAME]: tmpBin.socket }
      : {}),
    ...(tmpBin[SOCKET_CLI_NPM_BIN_NAME]
      ? { [SOCKET_CLI_NPM_BIN_NAME]: tmpBin[SOCKET_CLI_NPM_BIN_NAME] }
      : {}),
    ...(tmpBin[SOCKET_CLI_NPX_BIN_NAME]
      ? { [SOCKET_CLI_NPX_BIN_NAME]: tmpBin[SOCKET_CLI_NPX_BIN_NAME] }
      : {})
  }
  assert(
    util.isDeepStrictEqual(Object.keys(newBin).sort(naturalCompare), [
      SOCKET_CLI_BIN_NAME,
      SOCKET_CLI_NPM_BIN_NAME,
      SOCKET_CLI_NPX_BIN_NAME
    ]),
    "Update the rollup Legacy and Sentry build's .bin to match the default build."
  )
  return newBin
}

function resetDependencies(deps) {
  const { [SENTRY_NODE]: _ignored, ...newDeps } = { ...deps }
  return newDeps
}

async function updateDepStats(depStats) {
  const editablePkgJson = await readPackageJson(rootPath, { editable: true })

  const oldDepStats = existsSync(depStatsPath)
    ? await readJson(depStatsPath)
    : undefined
  Object.assign(
    depStats.dependencies,
    // Add existing package.json dependencies without old transitives. This
    // preserves dependencies that are indirectly referenced through spawned
    // processes and not directly imported.
    Object.fromEntries(
      Object.entries(editablePkgJson.content.dependencies).filter(
        ({ 0: key }) => !oldDepStats?.transitives?.[key]
      )
    )
  )
  // Remove Sentry as a direct dependency by default.
  delete depStats.dependencies[SENTRY_NODE]
  // Remove transitives from dependencies.
  for (const key of Object.keys(oldDepStats?.transitives ?? {})) {
    if (editablePkgJson.content.dependencies[key]) {
      depStats.transitives[key] = editablePkgJson.content.dependencies[key]
      depStats.external[key] = editablePkgJson.content.dependencies[key]
      delete depStats.dependencies[key]
    }
  }
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
  if (constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]) {
    // Add Sentry as a direct dependency for this build.
    depStats.dependencies[SENTRY_NODE] = (await getSentryManifest()).version
  }
  depStats.dependencies = toSortedObject(depStats.dependencies)
  depStats.devDependencies = toSortedObject(depStats.devDependencies)
  depStats.esm = toSortedObject(depStats.esm)
  depStats.external = toSortedObject(depStats.external)
  depStats.transitives = toSortedObject(depStats.transitives)
  // Write dep stats.
  await writeJson(depStatsPath, toSortedObject(depStats), { spaces: 2 })
  // Update dependencies with additional inlined modules.
  editablePkgJson.update({
    dependencies: {
      ...depStats.dependencies,
      ...depStats.transitives
    }
  })
  await editablePkgJson.save()
}

async function updatePackageJson() {
  const editablePkgJson = await readPackageJson(rootPath, { editable: true })
  const bin = resetBin(editablePkgJson.content.bin)
  const dependencies = resetDependencies(editablePkgJson.content.dependencies)
  editablePkgJson.update({
    name: SOCKET_CLI_PACKAGE_NAME,
    description: SOCKET_DESCRIPTION,
    bin,
    dependencies
  })
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD].
  if (constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]) {
    editablePkgJson.update({
      name: SOCKET_CLI_LEGACY_PACKAGE_NAME,
      bin: {
        [SOCKET_CLI_BIN_NAME_ALIAS]: bin[SOCKET_CLI_BIN_NAME],
        ...bin
      }
    })
  }
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
  else if (constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]) {
    editablePkgJson.update({
      name: SOCKET_CLI_SENTRY_PACKAGE_NAME,
      description: SOCKET_DESCRIPTION_WITH_SENTRY,
      bin: {
        [SOCKET_CLI_SENTRY_BIN_NAME_ALIAS]: bin[SOCKET_CLI_BIN_NAME],
        [SOCKET_CLI_SENTRY_BIN_NAME]: bin[SOCKET_CLI_BIN_NAME],
        [SOCKET_CLI_SENTRY_NPM_BIN_NAME]: bin[SOCKET_CLI_NPM_BIN_NAME],
        [SOCKET_CLI_SENTRY_NPX_BIN_NAME]: bin[SOCKET_CLI_NPX_BIN_NAME]
      },
      dependencies: {
        ...dependencies,
        [SENTRY_NODE]: (await getSentryManifest()).version
      }
    })
  }
  await editablePkgJson.save()
}

async function updatePackageLockFile() {
  if (!existsSync(rootPackageLockPath)) {
    return
  }
  const lockJson = await readJson(rootPackageLockPath)
  const rootPkg = lockJson.packages['']
  const bin = resetBin(rootPkg.bin)
  const dependencies = resetDependencies(rootPkg.dependencies)

  lockJson.name = SOCKET_CLI_PACKAGE_NAME
  rootPkg.name = SOCKET_CLI_PACKAGE_NAME
  rootPkg.bin = bin
  rootPkg.dependencies = dependencies
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD].
  if (constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]) {
    lockJson.name = SOCKET_CLI_LEGACY_PACKAGE_NAME
    rootPkg.name = SOCKET_CLI_LEGACY_PACKAGE_NAME
    rootPkg.bin = toSortedObject({
      [SOCKET_CLI_BIN_NAME_ALIAS]: bin[SOCKET_CLI_BIN_NAME],
      ...bin
    })
  }
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
  else if (constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]) {
    lockJson.name = SOCKET_CLI_SENTRY_PACKAGE_NAME
    rootPkg.name = SOCKET_CLI_SENTRY_PACKAGE_NAME
    rootPkg.bin = {
      [SOCKET_CLI_SENTRY_BIN_NAME_ALIAS]: bin[SOCKET_CLI_BIN_NAME],
      [SOCKET_CLI_SENTRY_BIN_NAME]: bin[SOCKET_CLI_BIN_NAME],
      [SOCKET_CLI_SENTRY_NPM_BIN_NAME]: bin[SOCKET_CLI_NPM_BIN_NAME],
      [SOCKET_CLI_SENTRY_NPX_BIN_NAME]: bin[SOCKET_CLI_NPX_BIN_NAME]
    }
    rootPkg.dependencies = toSortedObject({
      ...dependencies,
      [SENTRY_NODE]: (await getSentryManifest()).version
    })
  }
  await writeJson(rootPackageLockPath, lockJson, { spaces: 2 })
}

export default () => {
  const moduleSyncConfig = baseConfig({
    input: {
      ...sharedInputs,
      // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
      ...(constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
        ? {
            [INSTRUMENT_WITH_SENTRY]: `${rootSrcPath}/${INSTRUMENT_WITH_SENTRY}.ts`
          }
        : {})
    },
    output: [
      {
        ...sharedOutputs,
        dir: path.relative(rootPath, distModuleSyncPath)
      }
    ],
    external(id_, parentId_) {
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      const name = getPackageName(id)
      if (EXTERNAL_PACKAGES.includes(name)) {
        return true
      }
      if (
        INLINED_PACKAGES.includes(name) ||
        // Inline local src/ modules.
        id.startsWith(rootSrcPath) ||
        // Inline .mjs .mts modules.
        id.endsWith('.mjs') ||
        id.endsWith('.mts') ||
        // Inline relative referenced modules.
        isRelative(id) ||
        // Inline anything else that isn't a valid package name.
        !isValidPackageName(name)
      ) {
        return false
      }
      const parentId = parentId_ ? resolveId(parentId_) : undefined
      if (parentId && !isAncestorsExternal(parentId)) {
        return false
      }
      const resolvedId = resolveId(id, parentId)
      if (!isAncestorsExternal(resolvedId)) {
        return false
      }
      return true
    },
    plugins: [
      ...sharedPlugins,
      {
        async generateBundle(_options, bundle) {
          for (const basename of Object.keys(bundle)) {
            const data = bundle[basename]
            if (
              data.type === 'chunk' &&
              (basename === `${CONSTANTS}.js` ||
                basename === `${INSTRUMENT_WITH_SENTRY}.js`)
            ) {
              // eslint-disable-next-line no-await-in-loop
              await fs.mkdir(rootDistPath, { recursive: true })
              // eslint-disable-next-line no-await-in-loop
              await fs.writeFile(
                path.join(rootDistPath, basename),
                data.code,
                'utf8'
              )
              data.code = createStubCode(`../${basename}`)
            }
          }
        },
        async writeBundle() {
          await Promise.all([
            copyInitGradle(),
            copyBlessedWidgets(),
            updatePackageJson()
          ])
          // Update package-lock.json AFTER package.json.
          await updatePackageLockFile()
        }
      }
    ]
  })

  const keptRequireDtsMapFiles = new Set()
  const requireConfig = baseConfig({
    input: {
      ...sharedInputs
    },
    output: [
      {
        ...sharedOutputs,
        dir: path.relative(rootPath, distRequirePath)
      }
    ],
    plugins: [
      ...sharedPlugins,
      {
        async generateBundle(_options, bundle) {
          for (const basename of Object.keys(bundle)) {
            const data = bundle[basename]
            if (data.type === 'chunk') {
              if (
                basename !== VENDOR_JS &&
                !data.code.includes(`'./${VENDOR_JS}'`)
              ) {
                data.code = createStubCode(`../${MODULE_SYNC}/${basename}`)
              } else {
                keptRequireDtsMapFiles.add(
                  path.basename(basename, path.extname(basename))
                )
              }
            }
          }
        },
        async writeBundle() {
          await Promise.all([
            updateDepStats(requireConfig.meta.depStats),
            moveDtsAndMapFiles(CONSTANTS, distModuleSyncPath, rootDistPath),
            moveDtsAndMapFiles(VENDOR, distRequirePath, distModuleSyncPath),
            moveJsFiles(VENDOR, distRequirePath, distModuleSyncPath)
          ])
          await Promise.all([
            removeDtsAndMapFiles(CONSTANTS, distModuleSyncPath),
            removeDtsAndMapFiles(
              `!(${[...keptRequireDtsMapFiles].sort(naturalCompare).join('|')})`,
              distRequirePath
            ),
            // Stub out the ./dist/require/vendor.js file.
            fs.writeFile(
              path.join(distRequirePath, VENDOR_JS),
              createStubCode(`../${MODULE_SYNC}/${VENDOR_JS}`),
              'utf8'
            ),
            // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
            ...(constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
              ? [
                  moveDtsAndMapFiles(
                    INSTRUMENT_WITH_SENTRY,
                    distModuleSyncPath,
                    rootDistPath
                  ),
                  removeJsFiles(INSTRUMENT_WITH_SENTRY, distModuleSyncPath)
                ]
              : [
                  removeDtsAndMapFiles(INSTRUMENT_WITH_SENTRY, rootDistPath),
                  removeJsFiles(INSTRUMENT_WITH_SENTRY, rootDistPath)
                ])
          ])
        }
      }
    ]
  })

  return [moduleSyncConfig, requireConfig]
}
