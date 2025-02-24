import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import replacePlugin from '@rollup/plugin-replace'
import { glob as tinyGlob } from 'tinyglobby'

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
import { readJson } from '../scripts/utils/fs.js'
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
  SOCKET_IS_PUBLISHED,
  SOCKET_WITH_SENTRY,
  TAP,
  VENDOR,
  depStatsPath,
  rootDistPath,
  rootPackageLockPath,
  rootPath,
  rootSrcPath
} = constants

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
      `${version}:${gitHash}:${randomUUID().split('-')[0]}${constants.ENV[SOCKET_IS_PUBLISHED] ? ':pub' : ''}`
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
  // Lazily access constants.ENV[SOCKET_WITH_SENTRY].
  if (constants.ENV[SOCKET_WITH_SENTRY]) {
    // Add Sentry as a regular dep for this build.
    depStats.dependencies['@sentry/node'] = (await getSentryManifest()).version
  } else {
    delete depStats.dependencies['@sentry/node']
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
  const dependencies = { ...pkgJson.dependencies }
  const rawBin = pkgJson.bin ?? {}
  const tmpBin = {
    socket: rawBin.socket ?? rawBin['socket-with-sentry'],
    'socket-npm': rawBin['socket-npm'] ?? rawBin['socket-npm-with-sentry'],
    'socket-npx': rawBin['socket-npx'] ?? rawBin['socket-npx-with-sentry']
  }
  const bin = {
    ...(tmpBin.socket ? { socket: tmpBin.socket } : {}),
    ...(tmpBin['socket-npm'] ? { 'socket-npm': tmpBin['socket-npm'] } : {}),
    ...(tmpBin['socket-npx'] ? { 'socket-npx': tmpBin['socket-npx'] } : {})
  }
  assert(
    util.isDeepStrictEqual(Object.keys(bin).sort(naturalCompare), [
      'socket',
      'socket-npm',
      'socket-npx'
    ]),
    'If this fails, make sure to update the rollup sentry override for .bin to match the regular build!'
  )
  delete dependencies['@sentry/node']
  editablePkgJson.update({
    name: 'socket',
    description: 'CLI tool for Socket.dev',
    bin,
    dependencies
  })
  // Lazily access constants.ENV[SOCKET_WITH_SENTRY].
  if (constants.ENV[SOCKET_WITH_SENTRY]) {
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
        '@sentry/node': (await getSentryManifest()).version
      }
    })
  }
  await editablePkgJson.save()
}

async function updatePackageLockFile() {
  if (!existsSync(rootPackageLockPath)) {
    return
  }
  // Note: This should just replace the first occurrence, even if there are more.
  const lockSrc = await fs.readFile(rootPackageLockPath, 'utf8')
  let updatedLockSrc = lockSrc.replace(
    '"name": "@socketsecurity/socket-with-sentry",',
    '"name": "socket",'
  )
  // Lazily access constants.ENV[SOCKET_WITH_SENTRY].
  if (constants.ENV[SOCKET_WITH_SENTRY]) {
    updatedLockSrc = lockSrc.replace(
      '"name": "socket",',
      '"name": "@socketsecurity/socket-with-sentry",'
    )
  }
  await fs.writeFile(rootPackageLockPath, updatedLockSrc, 'utf8')
}

export default () => {
  const moduleSyncConfig = baseConfig({
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      constants: `${rootSrcPath}/constants.ts`,
      'shadow-bin': `${rootSrcPath}/shadow/shadow-bin.ts`,
      'npm-injection': `${rootSrcPath}/shadow/npm-injection.ts`,
      // Lazily access constants.ENV[SOCKET_WITH_SENTRY].
      ...(constants.ENV[SOCKET_WITH_SENTRY]
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
          "process.env['SOCKET_IS_PUBLISHED']": JSON.stringify(
            // Lazily access constants.ENV[SOCKET_IS_PUBLISHED].
            !!constants.ENV[SOCKET_IS_PUBLISHED]
          ),
          "process.env['SOCKET_WITH_SENTRY']": JSON.stringify(
            // Lazily access constants.ENV[SOCKET_WITH_SENTRY].
            !!constants.ENV[SOCKET_WITH_SENTRY]
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
          await Promise.all([
            copyInitGradle(),
            updatePackageJson(),
            updatePackageLockFile()
          ])
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
            // Lazily access constants.ENV[SOCKET_WITH_SENTRY].
            ...(constants.ENV[SOCKET_WITH_SENTRY]
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
