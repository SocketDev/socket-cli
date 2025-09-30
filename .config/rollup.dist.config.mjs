// import assert from 'node:assert'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// import util from 'node:util'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import fastGlob from 'fast-glob'
import trash from 'trash'

import { isDirEmptySync } from '@socketsecurity/registry/lib/fs'
// import { hasKeys } from '@socketsecurity/registry/lib/objects'
// import {
//   fetchPackageManifest,
//   readPackageJson,
// } from '@socketsecurity/registry/lib/packages'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
// import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
// import { spawn } from '@socketsecurity/registry/lib/spawn'

import baseConfig, { EXTERNAL_PACKAGES } from './rollup.base.config.mjs'
import constants from '../scripts/constants.mjs'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.mjs'
import {
  getPackageName,
  isBuiltin,
  normalizeId,
} from '../scripts/utils/packages.mjs'

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
  SHADOW_NPX_BIN,
  SHADOW_PNPM_BIN,
  SHADOW_YARN_BIN,
  SLASH_NODE_MODULES_SLASH,
  // SOCKET_CLI_BIN_NAME,
  // SOCKET_CLI_BIN_NAME_ALIAS,
  // SOCKET_CLI_LEGACY_PACKAGE_NAME,
  // SOCKET_CLI_NPM_BIN_NAME,
  // SOCKET_CLI_NPX_BIN_NAME,
  // SOCKET_CLI_PACKAGE_NAME,
  // SOCKET_CLI_PNPM_BIN_NAME,
  // SOCKET_CLI_SENTRY_BIN_NAME,
  // SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
  // SOCKET_CLI_SENTRY_NPM_BIN_NAME,
  // SOCKET_CLI_SENTRY_NPX_BIN_NAME,
  // SOCKET_CLI_SENTRY_PACKAGE_NAME,
  // SOCKET_CLI_SENTRY_PNPM_BIN_NAME,
  // SOCKET_CLI_SENTRY_YARN_BIN_NAME,
  // SOCKET_CLI_YARN_BIN_NAME,
} = constants

const BLESSED = 'blessed'
const BLESSED_CONTRIB = 'blessed-contrib'
const FLAGS = 'flags'
const LICENSE_MD = `LICENSE.md`
// const SENTRY_NODE = '@sentry/node'
// const SOCKET_DESCRIPTION = 'CLI for Socket.dev'
// const SOCKET_DESCRIPTION_WITH_SENTRY = `${SOCKET_DESCRIPTION}, includes Sentry error handling, otherwise identical to the regular \`${SOCKET_CLI_BIN_NAME}\` package`
const SOCKET_SECURITY_REGISTRY = '@socketsecurity/registry'
const UTILS = 'utils'
const VENDOR = 'vendor'

async function copyInitGradle() {
  const filepath = path.join(constants.srcPath, 'commands/manifest/init.gradle')
  const destPath = path.join(constants.distPath, 'init.gradle')
  await fs.copyFile(filepath, destPath)
}

async function copyBashCompletion() {
  const filepath = path.join(
    constants.srcPath,
    'commands/install/socket-completion.bash',
  )
  const destPath = path.join(constants.distPath, 'socket-completion.bash')
  await fs.copyFile(filepath, destPath)
}

async function copyExternalPackages() {
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
      { dereference: true },
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
          'index.js',
          'lib/**/*.js',
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
  const nmPath = path.join(constants.rootPath, NODE_MODULES)
  const pkgDestPath = path.join(constants.externalPath, pkgName)
  const pkgNmPath = path.join(nmPath, pkgName)
  // Copy entire package folder over to dist with dereference to follow symlinks.
  await fs.cp(pkgNmPath, pkgDestPath, { recursive: true, dereference: true })
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
// async function getSentryManifest() {
//   if (_sentryManifest === undefined) {
//     _sentryManifest = await fetchPackageManifest(`${SENTRY_NODE}@latest`)
//   }
//   return _sentryManifest
// }

async function copyPublishFiles() {
  // Determine which package.json to use based on build variant.
  let packageJsonSource
  if (constants.ENV[INLINED_SOCKET_CLI_LEGACY_BUILD]) {
    packageJsonSource = path.join(
      constants.rootPath,
      '.config/packages/package.cli-legacy.json',
    )
  } else if (constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]) {
    packageJsonSource = path.join(
      constants.rootPath,
      '.config/packages/package.cli-with-sentry.json',
    )
  } else {
    packageJsonSource = path.join(
      constants.rootPath,
      '.config/packages/package.cli.json',
    )
  }

  // Read the source package.json directly as JSON.
  const sourcePkgJson = JSON.parse(await fs.readFile(packageJsonSource, 'utf8'))

  // Write package.json to dist (version already set in package variant files).
  const distPackageJsonPath = path.join(constants.distPath, 'package.json')
  const distPkgJson = {
    ...sourcePkgJson,
  }
  await fs.writeFile(
    distPackageJsonPath,
    JSON.stringify(distPkgJson, null, 2) + '\n',
  )

  // Copy requirements.json and translations.json to dist.
  const filesToCopy = ['requirements.json', 'translations.json']
  await Promise.all(
    filesToCopy.map(file =>
      fs.copyFile(
        path.join(constants.rootPath, file),
        path.join(constants.distPath, file),
      ),
    ),
  )

  // Copy bin directory to dist.
  const binDir = path.join(constants.rootPath, 'bin')
  const distBinDir = path.join(constants.distPath, 'bin')
  await fs.mkdir(distBinDir, { recursive: true })
  const binFiles = await fs.readdir(binDir)
  await Promise.all(
    binFiles.map(file =>
      fs.copyFile(path.join(binDir, file), path.join(distBinDir, file)),
    ),
  )
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

// function resetBin(bin) {
//   const tmpBin = {
//     [SOCKET_CLI_BIN_NAME]:
//       bin?.[SOCKET_CLI_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_BIN_NAME],
//     [SOCKET_CLI_NPM_BIN_NAME]:
//       bin?.[SOCKET_CLI_NPM_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_NPM_BIN_NAME],
//     [SOCKET_CLI_NPX_BIN_NAME]:
//       bin?.[SOCKET_CLI_NPX_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_NPX_BIN_NAME],
//     [SOCKET_CLI_PNPM_BIN_NAME]:
//       bin?.[SOCKET_CLI_PNPM_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_PNPM_BIN_NAME],
//     [SOCKET_CLI_YARN_BIN_NAME]:
//       bin?.[SOCKET_CLI_YARN_BIN_NAME] ?? bin?.[SOCKET_CLI_SENTRY_YARN_BIN_NAME],
//   }
//   const newBin = {
//     ...(tmpBin[SOCKET_CLI_BIN_NAME]
//       ? { [SOCKET_CLI_BIN_NAME]: tmpBin.socket }
//       : {}),
//     ...(tmpBin[SOCKET_CLI_NPM_BIN_NAME]
//       ? { [SOCKET_CLI_NPM_BIN_NAME]: tmpBin[SOCKET_CLI_NPM_BIN_NAME] }
//       : {}),
//     ...(tmpBin[SOCKET_CLI_NPX_BIN_NAME]
//       ? { [SOCKET_CLI_NPX_BIN_NAME]: tmpBin[SOCKET_CLI_NPX_BIN_NAME] }
//       : {}),
//     ...(tmpBin[SOCKET_CLI_PNPM_BIN_NAME]
//       ? { [SOCKET_CLI_PNPM_BIN_NAME]: tmpBin[SOCKET_CLI_PNPM_BIN_NAME] }
//       : {}),
//     ...(tmpBin[SOCKET_CLI_YARN_BIN_NAME]
//       ? { [SOCKET_CLI_YARN_BIN_NAME]: tmpBin[SOCKET_CLI_YARN_BIN_NAME] }
//       : {}),
//   }
//   assert(
//     util.isDeepStrictEqual(Object.keys(newBin).sort(naturalCompare), [
//       SOCKET_CLI_BIN_NAME,
//       SOCKET_CLI_NPM_BIN_NAME,
//       SOCKET_CLI_NPX_BIN_NAME,
//       SOCKET_CLI_PNPM_BIN_NAME,
//       SOCKET_CLI_YARN_BIN_NAME,
//     ]),
//     "Update the rollup Legacy and Sentry build's .bin to match the default build.",
//   )
//   return newBin
// }

// function resetDependencies(deps) {
//   const { [SENTRY_NODE]: _ignored, ...newDeps } = { ...deps }
//   return newDeps
// }

export default async () => {
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
  const shadowNpxBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/npx/bin.mts'),
  )
  const shadowPnpmBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/pnpm/bin.mts'),
  )
  const shadowYarnBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/yarn/bin.mts'),
  )
  const utilsSrcPath = normalizePath(path.join(srcPath, UTILS))

  return [
    // Bundle <root>/src/ entry point files and output to <root>/dist/.
    baseConfig({
      input: {
        cli: `${srcPath}/cli.mts`,
        'npm-cli': `${srcPath}/npm-cli.mts`,
        'npx-cli': `${srcPath}/npx-cli.mts`,
        'pnpm-cli': `${srcPath}/pnpm-cli.mts`,
        'yarn-cli': `${srcPath}/yarn-cli.mts`,
        [CONSTANTS]: `${srcPath}/constants.mts`,
        [SHADOW_NPM_BIN]: `${srcPath}/shadow/npm/bin.mts`,
        [SHADOW_NPM_INJECT]: `${srcPath}/shadow/npm/inject.mts`,
        [SHADOW_NPX_BIN]: `${srcPath}/shadow/npx/bin.mts`,
        [SHADOW_PNPM_BIN]: `${srcPath}/shadow/pnpm/bin.mts`,
        [SHADOW_YARN_BIN]: `${srcPath}/shadow/yarn/bin.mts`,
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
              case shadowNpxBinSrcPath:
                return SHADOW_NPX_BIN
              case shadowPnpmBinSrcPath:
                return SHADOW_PNPM_BIN
              case shadowYarnBinSrcPath:
                return SHADOW_YARN_BIN
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
          sourcemap: false,
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
              copyPublishFiles(),
            ])
            // Copy external packages AFTER other operations to avoid conflicts.
            await copyExternalPackages()
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
      const relPath = `${path.relative(blessedContribSrcPath, filepath).slice(0, -4 /*.mjs*/)}.js`
      return {
        input: filepath,
        output: [
          {
            file: path.join(constants.blessedContribPath, relPath),
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
          // Fix blessed library octal escape sequences
          {
            name: 'fix-blessed-octal',
            transform(code, id) {
              if (
                id.includes('blessed') &&
                (id.includes('tput.js') || id.includes('box.js'))
              ) {
                return code
                  .replace(/ch = '\\200';/g, "ch = '\\x80';")
                  .replace(/'\\016'/g, "'\\x0E'")
                  .replace(/'\\017'/g, "'\\x0F'")
              }
              return null
            },
          },
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
