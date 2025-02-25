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
  SOCKET_IS_LEGACY_BUILD,
  SOCKET_IS_PUBLISHED_BUILD,
  SOCKET_IS_SENTRY_BUILD,
  TAP,
  VENDOR,
  depStatsPath,
  rootDistPath,
  rootPackageLockPath,
  rootPath,
  rootSrcPath
} = constants

const SENTRY_NODE = '@sentry/node'
const INSTRUMENT_WITH_SENTRY = 'instrument-with-sentry'
const VENDOR_JS = `${VENDOR}.js`

const distModuleSyncPath = path.join(rootDistPath, MODULE_SYNC)
const distRequirePath = path.join(rootDistPath, REQUIRE)

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
    _sentryManifest = await fetchPackageManifest('@sentry/node@latest')
  }
  return _sentryManifest
}

let _socketVersionHash
function getSocketVersionHash() {
  if (_socketVersionHash === undefined) {
    const { version } = readPackageJsonSync(rootPath)
    let gitHash = ''
    try {
      ;({ stdout: gitHash } = spawnSync(
        'git',
        ['rev-parse', '--short', 'HEAD'],
        'utf8'
      ))
    } catch {}
    // Make each build generate a unique version id, regardless.
    // Mostly for development: confirms the build refreshed. For prod
    // builds the git hash should suffice to identify the build.
    _socketVersionHash = JSON.stringify(
      `${version}:${gitHash}:${randomUUID().split('-')[0]}${constants.ENV[SOCKET_IS_PUBLISHED_BUILD] ? ':pub' : ''}`
    )
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
    socket: bin?.socket ?? bin?.['socket-with-sentry'],
    'socket-npm': bin?.['socket-npm'] ?? bin?.['socket-npm-with-sentry'],
    'socket-npx': bin?.['socket-npx'] ?? bin?.['socket-npx-with-sentry']
  }
  const newBin = {
    ...(tmpBin.socket ? { socket: tmpBin.socket } : {}),
    ...(tmpBin['socket-npm'] ? { 'socket-npm': tmpBin['socket-npm'] } : {}),
    ...(tmpBin['socket-npx'] ? { 'socket-npx': tmpBin['socket-npx'] } : {})
  }
  assert(
    util.isDeepStrictEqual(Object.keys(newBin).sort(naturalCompare), [
      'socket',
      'socket-npm',
      'socket-npx'
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
  // Lazily access constants.ENV[SOCKET_IS_SENTRY_BUILD].
  if (constants.ENV[SOCKET_IS_SENTRY_BUILD]) {
    // Add Sentry as a regular dep for this build.
    depStats.dependencies[SENTRY_NODE] = (await getSentryManifest()).version
  } else {
    delete depStats.dependencies[SENTRY_NODE]
  }
  // Write dep stats.
  await fs.writeFile(depStatsPath, `${formatObject(depStats)}\n`, 'utf8')
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
    name: 'socket',
    description: 'CLI tool for Socket.dev',
    bin,
    dependencies
  })
  // Lazily access constants.ENV[SOCKET_IS_LEGACY_BUILD].
  if (constants.ENV[SOCKET_IS_LEGACY_BUILD]) {
    editablePkgJson.update({
      name: '@socketsecurity/cli',
      bin: {
        cli: bin.socket,
        ...bin
      },
      dependencies: {
        ...dependencies,
        [SENTRY_NODE]: (await getSentryManifest()).version
      }
    })
  }
  // Lazily access constants.ENV[SOCKET_IS_SENTRY_BUILD].
  else if (constants.ENV[SOCKET_IS_SENTRY_BUILD]) {
    editablePkgJson.update({
      name: '@socketsecurity/socket-with-sentry',
      description:
        'CLI tool for Socket.dev, includes Sentry error handling, otherwise identical to the regular `socket` package',
      bin: {
        'socket-with-sentry': bin.socket,
        'socket-npm-with-sentry': bin['socket-npm'],
        'socket-npx-with-sentry': bin['socket-npx']
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
  const defaultName = 'socket'

  lockJson.name = defaultName
  rootPkg.name = defaultName
  rootPkg.bin = bin
  rootPkg.dependencies = dependencies
  // Lazily access constants.ENV[SOCKET_IS_LEGACY_BUILD].
  if (constants.ENV[SOCKET_IS_LEGACY_BUILD]) {
    const name = '@socketsecurity/cli'
    lockJson.name = name
    rootPkg.name = name
    rootPkg.bin = toSortedObject({
      cli: bin.socket,
      ...bin
    })
  }
  // Lazily access constants.ENV[SOCKET_IS_SENTRY_BUILD].
  else if (constants.ENV[SOCKET_IS_SENTRY_BUILD]) {
    const name = '@socketsecurity/socket-with-sentry'
    lockJson.name = name
    rootPkg.name = name
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
      cli: `${rootSrcPath}/cli.ts`,
      constants: `${rootSrcPath}/constants.ts`,
      'shadow-bin': `${rootSrcPath}/shadow/shadow-bin.ts`,
      'npm-injection': `${rootSrcPath}/shadow/npm-injection.ts`,
      // Lazily access constants.ENV[SOCKET_IS_SENTRY_BUILD].
      ...(constants.ENV[SOCKET_IS_SENTRY_BUILD]
        ? {
            [INSTRUMENT_WITH_SENTRY]: `${rootSrcPath}/${INSTRUMENT_WITH_SENTRY}.ts`
          }
        : {})
    },
    output: [
      {
        dir: path.relative(rootPath, distModuleSyncPath),
        entryFileNames: '[name].js',
        exports: 'auto',
        externalLiveBindings: false,
        format: 'cjs',
        freeze: false,
        sourcemap: true,
        sourcemapDebugIds: true
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
      // Inline process.env values.
      replacePlugin({
        delimiters: ['\\b', ''],
        preventAssignment: true,
        values: {
          "process.env['SOCKET_CLI_VERSION']"() {
            return JSON.stringify(getSocketVersionHash())
          },
          "process.env['SOCKET_IS_LEGACY_BUILD']": JSON.stringify(
            // Lazily access constants.ENV[SOCKET_IS_LEGACY_BUILD].
            !!constants.ENV[SOCKET_IS_LEGACY_BUILD]
          ),
          "process.env['SOCKET_IS_PUBLISHED_BUILD']": JSON.stringify(
            // Lazily access constants.ENV[SOCKET_IS_PUBLISHED_BUILD].
            !!constants.ENV[SOCKET_IS_PUBLISHED_BUILD]
          ),
          "process.env['SOCKET_IS_SENTRY_BUILD']": JSON.stringify(
            // Lazily access constants.ENV[SOCKET_IS_SENTRY_BUILD].
            !!constants.ENV[SOCKET_IS_SENTRY_BUILD]
          ),
          "process.env['TAP']": JSON.stringify(
            // Lazily access constants.ENV[TAP].
            !!constants.ENV[TAP]
          )
        }
      }),
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
        freeze: false,
        sourcemap: true,
        sourcemapDebugIds: true
      }
    ],
    plugins: [
      {
        async generateBundle(_options, bundle) {
          for (const basename of Object.keys(bundle)) {
            const data = bundle[basename]
            if (
              data.type === 'chunk' &&
              basename !== VENDOR_JS &&
              !data.code.includes(`'./${VENDOR_JS}'`)
            ) {
              data.code = createStubCode(`../${MODULE_SYNC}/${basename}`)
            }
          }
        },
        async writeBundle() {
          await Promise.all([
            updateDepStats(requireConfig.meta.depStats),
            removeDtsAndMapFiles('*', distRequirePath),
            moveDtsAndMapFiles(CONSTANTS, distModuleSyncPath, rootDistPath)
          ])
          await Promise.all([
            removeDtsAndMapFiles(CONSTANTS, distModuleSyncPath),
            // Lazily access constants.ENV[SOCKET_IS_SENTRY_BUILD].
            ...(constants.ENV[SOCKET_IS_SENTRY_BUILD]
              ? [
                  moveDtsAndMapFiles(
                    INSTRUMENT_WITH_SENTRY,
                    distModuleSyncPath,
                    rootDistPath
                  ),
                  removeJsFiles(INSTRUMENT_WITH_SENTRY, distModuleSyncPath)
                ]
              : [])
          ])
        }
      }
    ]
  })

  return [moduleSyncConfig, requireConfig]
}
