import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
  readPackageJson,
  readPackageJsonSync
} from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import baseConfig from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId
} from '../scripts/utils/packages.js'

const {
  BABEL_RUNTIME,
  CLI,
  CONSTANTS,
  INSTRUMENT_WITH_SENTRY,
  MODULE_SYNC,
  NPM_INJECTION,
  REQUIRE,
  ROLLUP_EXTERNAL_SUFFIX,
  SHADOW_BIN,
  SOCKET,
  SOCKET_CLI_LEGACY_BUILD,
  SOCKET_CLI_PUBLISHED_BUILD,
  SOCKET_CLI_SENTRY_BUILD,
  SOCKET_CLI_VERSION_HASH,
  VENDOR,
  VITEST,
  WITH_SENTRY,
  depStatsPath,
  rootDistPath,
  rootPackageLockPath,
  rootPath,
  rootSrcPath
} = constants

const CLI_WITH_SENTRY = `${CLI}-${WITH_SENTRY}`
const SENTRY_NODE = '@sentry/node'
const SOCKET_DESCRIPTION = 'CLI tool for Socket.dev'
const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling, otherwise identical to the regular \`${SOCKET}\` package`
const SOCKET_NPM = 'socket-npm'
const SOCKET_NPX = 'socket-npx'
const SOCKET_WITH_SENTRY = `socket-${WITH_SENTRY}`
const SOCKET_NPM_WITH_SENTRY = `${SOCKET_NPM}-${WITH_SENTRY}`
const SOCKET_NPX_WITH_SENTRY = `${SOCKET_NPX}-${WITH_SENTRY}`
const SOCKET_SECURITY_CLI = '@socketsecurity/cli'
const SOCKET_SECURITY_CLI_WITH_SENTRY = `${SOCKET_SECURITY_CLI}-${WITH_SENTRY}`
const VENDOR_JS = `${VENDOR}.js`

const distModuleSyncPath = path.join(rootDistPath, MODULE_SYNC)
const distRequirePath = path.join(rootDistPath, REQUIRE)

const sharedInputs = {
  cli: `${rootSrcPath}/cli.ts`,
  [CONSTANTS]: `${rootSrcPath}/${CONSTANTS}.ts`,
  [SHADOW_BIN]: `${rootSrcPath}/shadow/${SHADOW_BIN}.ts`,
  [NPM_INJECTION]: `${rootSrcPath}/shadow/${NPM_INJECTION}.ts`
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
    values: [
      [SOCKET_CLI_VERSION_HASH, () => JSON.stringify(getSocketVersionHash())],
      [
        SOCKET_CLI_LEGACY_BUILD,
        () =>
          JSON.stringify(
            // Lazily access constants.ENV[SOCKET_CLI_LEGACY_BUILD].
            !!constants.ENV[SOCKET_CLI_LEGACY_BUILD]
          )
      ],
      [
        SOCKET_CLI_PUBLISHED_BUILD,
        () =>
          JSON.stringify(
            // Lazily access constants.ENV[SOCKET_CLI_PUBLISHED_BUILD].
            !!constants.ENV[SOCKET_CLI_PUBLISHED_BUILD]
          )
      ],
      [
        SOCKET_CLI_SENTRY_BUILD,
        () =>
          JSON.stringify(
            // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
            !!constants.ENV[SOCKET_CLI_SENTRY_BUILD]
          )
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
  })
]

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

let _socketVersionHash
function getSocketVersionHash() {
  if (_socketVersionHash === undefined) {
    const randUuidSegment = randomUUID().split('-')[0]
    const { version } = readPackageJsonSync(rootPath)
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
      // Lazily access constants.ENV[SOCKET_CLI_PUBLISHED_BUILD].
      constants.ENV[SOCKET_CLI_PUBLISHED_BUILD] ? ':pub' : ':dev'
    }`
  }
  return _socketVersionHash
}

async function globDtsAndMapFiles(namePattern, srcPath) {
  return await tinyGlob([`**/${namePattern}{.d.ts{.map,},.js.map}`], {
    absolute: true,
    cwd: srcPath
  })
}

async function moveDtsAndMapFiles(namePattern, srcPath, destPath) {
  for (const filepath of await globDtsAndMapFiles(namePattern, srcPath)) {
    await fs.rename(filepath, path.join(destPath, path.basename(filepath)))
  }
}

async function removeDtsAndMapFiles(namePattern, srcPath) {
  for (const filepath of await globDtsAndMapFiles(namePattern, srcPath)) {
    await fs.rm(filepath)
  }
}

async function removeJsFiles(namePattern, srcPath) {
  for (const filepath of await tinyGlob([`**/${namePattern}.js`], {
    absolute: true,
    cwd: srcPath
  })) {
    await fs.rm(filepath)
  }
}

function resetBin(bin) {
  const tmpBin = {
    [SOCKET]: bin?.[SOCKET] ?? bin?.[SOCKET_WITH_SENTRY],
    [SOCKET_NPM]: bin?.[SOCKET_NPM] ?? bin?.[SOCKET_NPM_WITH_SENTRY],
    [SOCKET_NPX]: bin?.[SOCKET_NPX] ?? bin?.[SOCKET_NPX_WITH_SENTRY]
  }
  const newBin = {
    ...(tmpBin[SOCKET] ? { [SOCKET]: tmpBin.socket } : {}),
    ...(tmpBin[SOCKET_NPM] ? { [SOCKET_NPM]: tmpBin[SOCKET_NPM] } : {}),
    ...(tmpBin[SOCKET_NPX] ? { [SOCKET_NPX]: tmpBin[SOCKET_NPX] } : {})
  }
  assert(
    util.isDeepStrictEqual(Object.keys(newBin).sort(naturalCompare), [
      SOCKET,
      SOCKET_NPM,
      SOCKET_NPX
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
  const { content: pkgJson } = editablePkgJson
  const oldDepStats = existsSync(depStatsPath)
    ? await readJson(depStatsPath)
    : undefined
  Object.assign(
    depStats.dependencies,
    // Add existing package.json dependencies without old transitives. This
    // preserves dependencies like '@cyclonedx/cdxgen' and 'synp' that are
    // indirectly referenced through spawned processes and not directly imported.
    Object.fromEntries(
      Object.entries(pkgJson.dependencies).filter(
        ({ 0: key }) => !oldDepStats?.transitives?.[key]
      )
    )
  )
  // Remove Sentry as a direct dependency by default.
  delete depStats.dependencies[SENTRY_NODE]
  // Remove transitives from dependencies.
  for (const key of Object.keys(oldDepStats?.transitives ?? {})) {
    if (pkgJson.dependencies[key]) {
      depStats.transitives[key] = pkgJson.dependencies[key]
      depStats.external[key] = pkgJson.dependencies[key]
      delete depStats.dependencies[key]
    }
  }
  // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
  if (constants.ENV[SOCKET_CLI_SENTRY_BUILD]) {
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
  const { content: pkgJson } = editablePkgJson
  const bin = resetBin(pkgJson.bin)
  const dependencies = resetDependencies(pkgJson.dependencies)
  editablePkgJson.update({
    name: SOCKET,
    description: SOCKET_DESCRIPTION,
    bin,
    dependencies
  })
  // Lazily access constants.ENV[SOCKET_CLI_LEGACY_BUILD].
  if (constants.ENV[SOCKET_CLI_LEGACY_BUILD]) {
    editablePkgJson.update({
      name: SOCKET_SECURITY_CLI,
      bin: {
        [CLI]: bin[SOCKET],
        ...bin
      }
    })
  }
  // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
  else if (constants.ENV[SOCKET_CLI_SENTRY_BUILD]) {
    editablePkgJson.update({
      name: SOCKET_SECURITY_CLI_WITH_SENTRY,
      description: SOCKET_DESCRIPTION_WITH_SENTRY,
      bin: {
        [CLI_WITH_SENTRY]: bin[SOCKET],
        [SOCKET_WITH_SENTRY]: bin[SOCKET],
        [SOCKET_NPM_WITH_SENTRY]: bin[SOCKET_NPM],
        [SOCKET_NPX_WITH_SENTRY]: bin[SOCKET_NPX]
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

  lockJson.name = SOCKET
  rootPkg.name = SOCKET
  rootPkg.bin = bin
  rootPkg.dependencies = dependencies
  // Lazily access constants.ENV[SOCKET_CLI_LEGACY_BUILD].
  if (constants.ENV[SOCKET_CLI_LEGACY_BUILD]) {
    lockJson.name = SOCKET_SECURITY_CLI
    rootPkg.name = SOCKET_SECURITY_CLI
    rootPkg.bin = toSortedObject({
      [CLI]: bin[SOCKET],
      ...bin
    })
  }
  // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
  else if (constants.ENV[SOCKET_CLI_SENTRY_BUILD]) {
    lockJson.name = SOCKET_SECURITY_CLI_WITH_SENTRY
    rootPkg.name = SOCKET_SECURITY_CLI_WITH_SENTRY
    rootPkg.bin = {
      [CLI_WITH_SENTRY]: bin[SOCKET],
      [SOCKET_WITH_SENTRY]: bin[SOCKET],
      [SOCKET_NPM_WITH_SENTRY]: bin[SOCKET_NPM],
      [SOCKET_NPX_WITH_SENTRY]: bin[SOCKET_NPX]
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
      // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
      ...(constants.ENV[SOCKET_CLI_SENTRY_BUILD]
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
    external(id_) {
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      const name = getPackageName(id)
      if (
        // Inline Babel helpers.
        name === BABEL_RUNTIME ||
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
              await fs.mkdir(rootDistPath, { recursive: true })
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
          await Promise.all([copyInitGradle(), updatePackageJson()])
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
            removeDtsAndMapFiles(
              `!(${[...keptRequireDtsMapFiles].sort(naturalCompare).join('|')})`,
              distRequirePath
            ),
            moveDtsAndMapFiles(CONSTANTS, distModuleSyncPath, rootDistPath)
          ])
          await Promise.all([
            removeDtsAndMapFiles(CONSTANTS, distModuleSyncPath),
            // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
            ...(constants.ENV[SOCKET_CLI_SENTRY_BUILD]
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
