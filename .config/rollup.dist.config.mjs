import assert from 'node:assert'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'

import { glob as tinyGlob } from 'tinyglobby'

import { readJson, remove, writeJson } from '@socketsecurity/registry/lib/fs'
import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackageManifest,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import baseConfig, { BUNDLED_PACKAGES } from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'

const {
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
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
  rootDistPath,
  rootPackageLockPath,
  rootPath,
  rootSrcPath
} = constants

const SENTRY_NODE = '@sentry/node'
const SOCKET_DESCRIPTION = 'CLI tool for Socket.dev'
const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling, otherwise identical to the regular \`${SOCKET_CLI_BIN_NAME}\` package`

async function copyInitGradle() {
  const filepath = path.join(rootSrcPath, 'commands/manifest/init.gradle')
  const destPath = path.join(rootDistPath, 'init.gradle')
  await fs.copyFile(filepath, destPath)
}

async function copyPackage(pkgName) {
  const pkgDestPath = path.join(rootDistPath, pkgName)
  const pkgNmPath = path.join(rootPath, `node_modules/${pkgName}`)
  // Copy entire package folder over to dist.
  await fs.cp(pkgNmPath, pkgDestPath, { recursive: true })
  // Add 'use strict' directive to js files.
  const jsFiles = await tinyGlob(['**/*.js'], {
    absolute: true,
    cwd: pkgDestPath,
    ignore: ['node_modules/**']
  })
  await Promise.all(
    jsFiles.map(async p => {
      const content = await fs.readFile(p, 'utf8')
      // Start by trimming the hashbang.
      const hashbang = /^#!.*(?:\r?\n)*/.exec(content)?.[0] ?? ''
      let trimmed = content.slice(hashbang.length).trimStart()
      // Then, trim "use strict" directive.
      const useStrict =
        /^(['"])use strict\1;?(?:\r?\n)*/.exec(trimmed)?.[0] ?? ''
      trimmed = trimmed.slice(useStrict.length).trimStart()
      // Add back hashbang and add "use strict" directive.
      const modded = `${hashbang.trim()}${hashbang ? os.EOL : ''}${useStrict.trim() || "'use strict'"}${os.EOL}${os.EOL}${trimmed}`
      await fs.writeFile(p, modded, 'utf8')
    })
  )
}

let _sentryManifest
async function getSentryManifest() {
  if (_sentryManifest === undefined) {
    _sentryManifest = await fetchPackageManifest(`${SENTRY_NODE}@latest`)
  }
  return _sentryManifest
}

async function removeDirs(srcPath, options) {
  const { exclude } = { __proto__: null, ...options }
  const ignore = Array.isArray(exclude) ? exclude : exclude ? [exclude] : []
  return Promise.all([
    (
      await tinyGlob(['**/*'], {
        absolute: true,
        onlyDirectories: true,
        cwd: srcPath,
        dot: true,
        ignore
      })
    ).map(p => remove(p))
  ])
}

async function removeFiles(srcPath, options) {
  const { exclude } = { __proto__: null, ...options }
  const ignore = Array.isArray(exclude) ? exclude : exclude ? [exclude] : []
  return Promise.all([
    (
      await tinyGlob(['**/*'], {
        absolute: true,
        onlyFiles: true,
        cwd: srcPath,
        dot: true,
        ignore
      })
    ).map(p => remove(p))
  ])
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

export default () =>
  baseConfig({
    output: [
      {
        dir: path.relative(rootPath, rootDistPath),
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
        async writeBundle() {
          await Promise.all([
            copyInitGradle(),
            updatePackageJson(),
            ...BUNDLED_PACKAGES.map(n => copyPackage(n))
          ])

          const blessedDestPath = path.join(rootDistPath, 'blessed')
          const blessedIgnore = [
            'lib/**',
            'node_modules/**',
            'usr/**',
            'vendor/**',
            'LICENSE*'
          ]

          const blessedContribDestPath = path.join(
            rootDistPath,
            'blessed-contrib'
          )
          const blessedContribIgnore = [
            'lib/**',
            'node_modules/**',
            'index.d.ts',
            'LICENSE*'
          ]

          // Remove directories.
          await Promise.all([
            removeDirs(blessedDestPath, { exclude: blessedIgnore }),
            removeDirs(blessedContribDestPath, {
              exclude: blessedContribIgnore
            })
          ])

          // Remove files.
          await Promise.all([
            removeFiles(blessedDestPath, { exclude: blessedIgnore }),
            removeFiles(blessedContribDestPath, {
              exclude: blessedContribIgnore
            })
          ])

          // Rewire 'blessed' inside 'blessed-contrib'.
          await Promise.all([
            ...(
              await tinyGlob(['**/*.js'], {
                absolute: true,
                cwd: blessedContribDestPath,
                ignore: ['node_modules/**']
              })
            ).map(async p => {
              const relPath = path.relative(path.dirname(p), blessedDestPath)
              const content = await fs.readFile(p, 'utf8')
              const modded = content.replace(
                /(?<=require\(["'])blessed(?=(?:\/[^"']+)?["']\))/g,
                () => relPath
              )
              await fs.writeFile(p, modded, 'utf8')
            })
          ])

          // Update package-lock.json AFTER package.json.
          await updatePackageLockFile()
        }
      }
    ]
  })
