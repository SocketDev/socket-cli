import assert from 'node:assert'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import fastGlob from 'fast-glob'
import trash from 'trash'

import {
  isDirEmptySync,
  readJson,
  writeJson,
} from '@socketsecurity/registry/lib/fs'
import { hasKeys, toSortedObject } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackageManifest,
  readPackageJson,
} from '@socketsecurity/registry/lib/packages'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import baseConfig, { EXTERNAL_PACKAGES } from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId,
} from '../scripts/utils/packages.js'

const {
  CONSTANTS,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INSTRUMENT_WITH_SENTRY,
  NODE_MODULES,
  NODE_MODULES_GLOB_RECURSIVE,
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
} = constants

const BLESSED = 'blessed'
const BLESSED_CONTRIB = 'blessed-contrib'
const FLAGS = 'flags'
const LICENSE_MD = `LICENSE.md`
const SENTRY_NODE = '@sentry/node'
const SOCKET_DESCRIPTION = 'CLI for Socket.dev'
const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling, otherwise identical to the regular \`${SOCKET_CLI_BIN_NAME}\` package`
const SOCKET_SECURITY_REGISTRY = '@socketsecurity/registry'
const UTILS = 'utils'
const VENDOR = 'vendor'

async function copyInitGradle() {
  // Lazily access constants path properties.
  const filepath = path.join(constants.srcPath, 'commands/manifest/init.gradle')
  const destPath = path.join(constants.distPath, 'init.gradle')
  await fs.copyFile(filepath, destPath)
}

async function copyBashCompletion() {
  // Lazily access constants path properties.
  const filepath = path.join(
    constants.srcPath,
    'commands/install/socket-completion.bash',
  )
  const destPath = path.join(constants.distPath, 'socket-completion.bash')
  await fs.copyFile(filepath, destPath)
}

async function copyExternalPackages() {
  // Lazily access constants path properties.
  const { blessedContribPath, blessedPath, socketRegistryPath } = constants
  const nmPath = path.join(constants.rootPath, NODE_MODULES)
  const blessedContribNmPath = path.join(nmPath, BLESSED_CONTRIB)

  // Copy package folders.
  await Promise.all([
    ...EXTERNAL_PACKAGES
      // Skip copying 'blessed-contrib' over because we already
      // have it bundled as ./external/blessed-contrib.
      .filter(n => n !== BLESSED_CONTRIB)
      // Copy the other packages over to ./external/.
      .map(n =>
        copyPackage(n, {
          strict:
            // Skip adding 'use strict' directives to Socket packages.
            n !== SOCKET_SECURITY_REGISTRY,
        }),
      ),
    // Copy 'blessed-contrib' license over to
    // ./external/blessed-contrib/LICENSE.md.
    await fs.cp(
      `${blessedContribNmPath}/${LICENSE_MD}`,
      `${blessedContribPath}/${LICENSE_MD}`,
    ),
  ])

  const alwaysIgnoredPatterns = ['LICENSE*', 'README*']

  // Cleanup package files.
  await Promise.all(
    [
      [blessedPath, ['lib/**/*.js', 'usr/**/**', 'vendor/**/*.js']],
      [blessedContribPath, ['lib/**/*.js', 'index.js']],
      [
        socketRegistryPath,
        [
          'external/**/*.js',
          'lib/**/*.js',
          'index.js',
          'extensions.json',
          'manifest.json',
        ],
      ],
    ].map(async ({ 0: thePath, 1: ignorePatterns }) => {
      await removeFiles(thePath, {
        exclude: [...alwaysIgnoredPatterns, ...ignorePatterns],
      })
      await removeEmptyDirs(thePath)
    }),
  )
  // Rewire 'blessed' inside 'blessed-contrib'.
  await Promise.all(
    (
      await fastGlob.glob(['**/*.js'], {
        absolute: true,
        cwd: blessedContribPath,
        ignore: [NODE_MODULES_GLOB_RECURSIVE],
      })
    ).map(async p => {
      const relPath = path.relative(path.dirname(p), blessedPath)
      const content = await fs.readFile(p, 'utf8')
      const modded = content.replace(
        /(?<=require\(["'])blessed(?=(?:\/[^"']+)?["']\))/g,
        () => relPath,
      )
      await fs.writeFile(p, modded, 'utf8')
    }),
  )
}

async function copyPackage(pkgName, options) {
  const { strict = true } = { __proto__: null, ...options }
  // Lazily access constants path properties.
  const nmPath = path.join(constants.rootPath, NODE_MODULES)
  const pkgDestPath = path.join(constants.externalPath, pkgName)
  const pkgNmPath = path.join(nmPath, pkgName)
  // Copy entire package folder over to dist.
  await fs.cp(pkgNmPath, pkgDestPath, { recursive: true })
  if (strict) {
    // Add 'use strict' directive to js files.
    const jsFiles = await fastGlob.glob(['**/*.js'], {
      absolute: true,
      cwd: pkgDestPath,
      ignore: [NODE_MODULES_GLOB_RECURSIVE],
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
      }),
    )
  }
}

let _sentryManifest
async function getSentryManifest() {
  if (_sentryManifest === undefined) {
    _sentryManifest = await fetchPackageManifest(`${SENTRY_NODE}@latest`)
  }
  return _sentryManifest
}

async function updatePackageJson() {
  // Lazily access constants.rootPath.
  const editablePkgJson = await readPackageJson(constants.rootPath, {
    editable: true,
    normalize: true,
  })
  const bin = resetBin(editablePkgJson.content.bin)
  const dependencies = resetDependencies(editablePkgJson.content.dependencies)
  editablePkgJson.update({
    name: SOCKET_CLI_PACKAGE_NAME,
    description: SOCKET_DESCRIPTION,
    bin,
    dependencies: hasKeys(dependencies) ? dependencies : undefined,
  })
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD].
  if (constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]) {
    editablePkgJson.update({
      name: SOCKET_CLI_LEGACY_PACKAGE_NAME,
      bin: {
        [SOCKET_CLI_BIN_NAME_ALIAS]: bin[SOCKET_CLI_BIN_NAME],
        ...bin,
      },
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
        [SOCKET_CLI_SENTRY_NPX_BIN_NAME]: bin[SOCKET_CLI_NPX_BIN_NAME],
      },
      dependencies: {
        ...dependencies,
        [SENTRY_NODE]: (await getSentryManifest()).version,
      },
    })
  }
  await editablePkgJson.save()
}

async function updatePackageLockFile() {
  // Lazily access constants.rootPackageLockPath.
  const { rootPackageLockPath } = constants
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
  if (hasKeys(dependencies)) {
    rootPkg.dependencies = dependencies
  } else {
    delete rootPkg.dependencies
  }
  // Lazily access constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD].
  if (constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]) {
    lockJson.name = SOCKET_CLI_LEGACY_PACKAGE_NAME
    rootPkg.name = SOCKET_CLI_LEGACY_PACKAGE_NAME
    rootPkg.bin = toSortedObject({
      [SOCKET_CLI_BIN_NAME_ALIAS]: bin[SOCKET_CLI_BIN_NAME],
      ...bin,
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
      [SOCKET_CLI_SENTRY_NPX_BIN_NAME]: bin[SOCKET_CLI_NPX_BIN_NAME],
    }
    rootPkg.dependencies = toSortedObject({
      ...dependencies,
      [SENTRY_NODE]: (await getSentryManifest()).version,
    })
  }
  await writeJson(rootPackageLockPath, lockJson, { spaces: 2 })
}

async function removeEmptyDirs(thePath) {
  await trash(
    (
      await fastGlob.glob(['**/'], {
        ignore: [NODE_MODULES_GLOB_RECURSIVE],
        absolute: true,
        cwd: thePath,
        onlyDirectories: true,
      })
    )
      // Sort directory paths longest to shortest.
      .sort((a, b) => b.length - a.length)
      .filter(isDirEmptySync),
  )
}

async function removeFiles(thePath, options) {
  const { exclude } = { __proto__: null, ...options }
  const ignore = Array.isArray(exclude) ? exclude : exclude ? [exclude] : []
  return await trash(
    await fastGlob.glob(['**/*'], {
      absolute: true,
      onlyFiles: true,
      cwd: thePath,
      dot: true,
      ignore,
    }),
  )
}

function resetBin(bin) {
  const tmpBin = {
    [SOCKET_CLI_BIN_NAME]:
      bin?.[SOCKET_CLI_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_BIN_NAME],
    [SOCKET_CLI_NPM_BIN_NAME]:
      bin?.[SOCKET_CLI_NPM_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_NPM_BIN_NAME],
    [SOCKET_CLI_NPX_BIN_NAME]:
      bin?.[SOCKET_CLI_NPX_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_NPX_BIN_NAME],
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
      : {}),
  }
  assert(
    util.isDeepStrictEqual(Object.keys(newBin).sort(naturalCompare), [
      SOCKET_CLI_BIN_NAME,
      SOCKET_CLI_NPM_BIN_NAME,
      SOCKET_CLI_NPX_BIN_NAME,
    ]),
    "Update the rollup Legacy and Sentry build's .bin to match the default build.",
  )
  return newBin
}

function resetDependencies(deps) {
  const { [SENTRY_NODE]: _ignored, ...newDeps } = { ...deps }
  return newDeps
}

export default async () => {
  // Lazily access constants path properties.
  const { configPath, distPath, rootPath, srcPath } = constants
  const nmPath = normalizePath(path.join(rootPath, NODE_MODULES))
  const constantsSrcPath = normalizePath(path.join(srcPath, 'constants.mts'))
  const externalSrcPath = normalizePath(path.join(srcPath, 'external'))
  const blessedContribSrcPath = normalizePath(
    path.join(externalSrcPath, BLESSED_CONTRIB),
  )
  const flagsSrcPath = normalizePath(path.join(srcPath, 'flags.mts'))
  const shadowNpmBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/npm/bin.mts'),
  )
  const shadowNpmInjectSrcPath = normalizePath(
    path.join(srcPath, 'shadow/npm/inject.mts'),
  )
  const utilsSrcPath = normalizePath(path.join(srcPath, UTILS))

  return [
    // Bundle <root>/src/ entry point files and output to <root>/dist/.
    baseConfig({
      input: {
        cli: `${srcPath}/cli.mts`,
        [CONSTANTS]: `${srcPath}/constants.mts`,
        [SHADOW_NPM_BIN]: `${srcPath}/shadow/npm/bin.mts`,
        [SHADOW_NPM_INJECT]: `${srcPath}/shadow/npm/inject.mts`,
        // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
        ...(constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
          ? {
              [INSTRUMENT_WITH_SENTRY]: `${srcPath}/${INSTRUMENT_WITH_SENTRY}.mts`,
            }
          : {}),
      },
      output: [
        {
          dir: path.relative(rootPath, distPath),
          chunkFileNames: '[name].js',
          entryFileNames: '[name].js',
          exports: 'auto',
          externalLiveBindings: false,
          format: 'cjs',
          manualChunks(id_) {
            const id = normalizeId(id_)
            switch (id) {
              case constantsSrcPath:
                return CONSTANTS
              case flagsSrcPath:
                return FLAGS
              case shadowNpmBinSrcPath:
                return SHADOW_NPM_BIN
              case shadowNpmInjectSrcPath:
                return SHADOW_NPM_INJECT
              default:
                if (id.startsWith(`${utilsSrcPath}/`)) {
                  return UTILS
                }
                if (id.includes(SLASH_NODE_MODULES_SLASH)) {
                  return VENDOR
                }
                return null
            }
          },
          sourcemap: true,
          sourcemapDebugIds: true,
        },
      ],
      plugins: [
        // Replace require() and require.resolve() calls like
        // require('blessed/lib/widgets/screen') with
        // require('../external/blessed/lib/widgets/screen')
        ...EXTERNAL_PACKAGES.map(n =>
          socketModifyPlugin({
            find: new RegExp(
              `(?<=require[$\\w]*(?:\\.resolve)?\\(["'])${escapeRegExp(n)}(?=(?:\\/[^"']+)?["']\\))`,
              'g',
            ),
            replace: id => `../external/${id}`,
          }),
        ),
        // Replace require.resolve('node-gyp/bin/node-gyp.js') with
        // require('./constants.js').npmNmNodeGypPath.
        socketModifyPlugin({
          find: /require[$\w]*\.resolve\(["']node-gyp\/bin\/node-gyp.js["']\)/g,
          replace: "require('./constants.js').npmNmNodeGypPath",
        }),
        // Replace resolve(__dirname, '../lib/node-gyp-bin') with
        // require('./constants.js').npmNmNodeGypPath.
        socketModifyPlugin({
          find: /resolve\(__dirname,\s*["']\.\.\/lib\/node-gyp-bin["']\)/g,
          replace: "require('./constants.js').npmNmNodeGypPath",
        }),
        {
          async writeBundle() {
            await Promise.all([
              copyInitGradle(),
              copyBashCompletion(),
              updatePackageJson(),
              // Remove dist/vendor.js.map file.
              trash([path.join(distPath, `${VENDOR}.js.map`)]),
              copyExternalPackages(),
            ])
            // Update package-lock.json AFTER package.json.
            await updatePackageLockFile()
          },
        },
      ],
    }),
    // Bundle <root>/src/external/blessed-contrib/ files and output to
    // <root>/external/blessed-contrib/.
    ...(
      await fastGlob.glob(['**/*.mjs'], {
        absolute: true,
        cwd: blessedContribSrcPath,
      })
    ).map(filepath => {
      const relPath = `${path.relative(srcPath, filepath).slice(0, -4 /*.mjs*/)}.js`
      return {
        input: filepath,
        output: [
          {
            file: path.join(rootPath, relPath),
            exports: 'auto',
            externalLiveBindings: false,
            format: 'cjs',
            inlineDynamicImports: true,
            sourcemap: false,
          },
        ],
        external(rawId) {
          const id = normalizeId(rawId)
          const pkgName = getPackageName(
            id,
            path.isAbsolute(id) ? nmPath.length + 1 : 0,
          )
          return (
            pkgName === BLESSED ||
            rawId.endsWith(ROLLUP_EXTERNAL_SUFFIX) ||
            isBuiltin(rawId)
          )
        },
        plugins: [
          nodeResolve({
            exportConditions: ['node'],
            extensions: ['.mjs', '.js', '.json'],
            preferBuiltins: true,
          }),
          jsonPlugin(),
          commonjsPlugin({
            defaultIsModuleExports: true,
            extensions: ['.cjs', '.js'],
            ignoreDynamicRequires: true,
            ignoreGlobal: true,
            ignoreTryCatch: true,
            strictRequires: true,
          }),
          babelPlugin({
            babelHelpers: 'runtime',
            babelrc: false,
            configFile: path.join(configPath, 'babel.config.js'),
            extensions: ['.js', '.cjs', '.mjs'],
          }),
        ],
      }
    }),
  ]
}
