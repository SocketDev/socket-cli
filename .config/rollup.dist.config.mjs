import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { deleteAsync } from 'del'
import fastGlob from 'fast-glob'

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
import { isBuiltin, normalizeId } from '../scripts/utils/packages.mjs'

const {
  CONSTANTS,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  PRELOAD_SENTRY,
  NODE_MODULES,
  NODE_MODULES_GLOB_RECURSIVE,
  SHADOW_NPM_BIN,
  SHADOW_NPM_PRELOAD_ARBORIST,
  SHADOW_NPX_BIN,
  SHADOW_PNPM_BIN,
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

const FLAGS = 'flags'
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
  const { socketRegistryPath } = constants

  // Copy package folders.
  await Promise.all(
    EXTERNAL_PACKAGES.map(n =>
      copyPackage(n, {
        strict:
          // Skip adding 'use strict' directives to Socket packages.
          n !== SOCKET_SECURITY_REGISTRY,
      }),
    ),
  )

  const alwaysIgnoredPatterns = ['LICENSE*', 'README*']

  // Cleanup package files.
  await Promise.all(
    [
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
  // Remove all source map files from external packages.
  await removeFiles(constants.externalPath, {
    exclude: [
      ...alwaysIgnoredPatterns,
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.json',
      '**/*.d.ts',
    ],
  })
  // Rewire '@socketsecurity/registry' inside '@socketsecurity/sdk'.
  const sdkPath = path.join(constants.externalPath, '@socketsecurity/sdk')
  await Promise.all(
    (
      await fastGlob.glob(['**/*.js'], {
        absolute: true,
        cwd: sdkPath,
        ignore: [NODE_MODULES_GLOB_RECURSIVE],
      })
    ).map(async p => {
      const relPath = path.relative(path.dirname(p), socketRegistryPath)
      const content = await fs.readFile(p, 'utf8')
      const modded = content.replace(
        /(?<=require\(["'])@socketsecurity\/registry(?=(?:\/[^"']+)?["']\))/g,
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

  // JSON files are now inlined during build via @rollup/plugin-json

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
  await deleteAsync(
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
  return await deleteAsync(
    await fastGlob.glob(['**/*'], {
      absolute: true,
      onlyFiles: true,
      cwd: thePath,
      dot: true,
      ignore: Array.isArray(exclude) 
        ? exclude 
        : (exclude ? [exclude] : []),
    }),
  )
}

export default async () => {
  const { distPath, rootPath, srcPath } = constants
  const constantsSrcPath = normalizePath(path.join(srcPath, 'constants.mts'))
  const flagsSrcPath = normalizePath(path.join(srcPath, 'flags.mts'))
  const shadowNpmBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/npm/bin.mts'),
  )
  const shadowNpmPreloadArboristSrcPath = normalizePath(
    path.join(srcPath, 'shadow/npm/preload-arborist.mts'),
  )
  const shadowNpxBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/npx/bin.mts'),
  )
  const shadowPnpmBinSrcPath = normalizePath(
    path.join(srcPath, 'shadow/pnpm/bin.mts'),
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
        [CONSTANTS]: `${srcPath}/constants.mts`,
        [SHADOW_NPM_BIN]: `${srcPath}/shadow/npm/bin.mts`,
        [SHADOW_NPM_PRELOAD_ARBORIST]: `${srcPath}/shadow/npm/preload-arborist.mts`,
        [SHADOW_NPX_BIN]: `${srcPath}/shadow/npx/bin.mts`,
        [SHADOW_PNPM_BIN]: `${srcPath}/shadow/pnpm/bin.mts`,
        ...(constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
          ? {
              [PRELOAD_SENTRY]: `${srcPath}/${PRELOAD_SENTRY}.mts`,
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
          experimentalMinChunkSize: 10000,
          generatedCode: {
            preset: 'es2015',
            arrowFunctions: true,
            constBindings: true,
            objectShorthand: true
          },
          compact: true,
          manualChunks(id_) {
            const id = normalizeId(id_)
            switch (id) {
              case constantsSrcPath:
                return CONSTANTS
              case flagsSrcPath:
                return FLAGS
              case shadowNpmBinSrcPath:
                return SHADOW_NPM_BIN
              case shadowNpmPreloadArboristSrcPath:
                return SHADOW_NPM_PRELOAD_ARBORIST
              case shadowNpxBinSrcPath:
                return SHADOW_NPX_BIN
              case shadowPnpmBinSrcPath:
                return SHADOW_PNPM_BIN
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
        // Replace require() and require.resolve() calls for @socketsecurity/registry
        // require('@socketsecurity/registry/lib/path') with
        // require('./external/@socketsecurity/registry/dist/lib/path')
        socketModifyPlugin({
          find: new RegExp(
            `(?<=require[$\\w]*(?:\\.resolve)?\\(["'])${escapeRegExp(SOCKET_SECURITY_REGISTRY)}(?=(?:\\/[^"']+)?["']\\))`,
            'g',
          ),
          replace: () => `./external/${SOCKET_SECURITY_REGISTRY}/dist`,
        }),
        // Replace individual registry constant requires with index file require.
        // require('./external/@socketsecurity/registry/dist/lib/constants/socket-public-api-token') with
        // require('./external/@socketsecurity/registry/dist/lib/constants/index')
        socketModifyPlugin({
          find: new RegExp(
            `(?<=require[$\\w]*(?:\\.resolve)?\\(["'])(\\.+/external/${escapeRegExp(SOCKET_SECURITY_REGISTRY)}/dist/lib/constants)/[^"']+(?=["']\\))`,
            'g',
          ),
          replace: (match, prefix) => `${prefix}/index`,
        }),
        // Replace require() and require.resolve() calls for other external packages
        // (currently just @socketsecurity/sdk).
        ...EXTERNAL_PACKAGES.filter(n => n !== SOCKET_SECURITY_REGISTRY).map(
          n =>
            socketModifyPlugin({
              find: new RegExp(
                `(?<=require[$\\w]*(?:\\.resolve)?\\(["'])${escapeRegExp(n)}(?=(?:\\/[^"']+)?["']\\))`,
                'g',
              ),
              replace: id => `./external/${id}`,
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
    // Bundle external wrapper modules separately
    // Each external module gets its own self-contained bundle
    // Bundle each one individually to avoid code splitting
    baseConfig({
      input: `${srcPath}/external/ink.mjs`,
      output: {
        file: path.join(path.relative(rootPath, distPath), 'external/ink.js'),
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        generatedCode: {
          preset: 'es2015',
          arrowFunctions: true,
          constBindings: true,
          objectShorthand: true
        },
        compact: true,
        sourcemap: false,
        inlineDynamicImports: true,
      },
      // Override external to bundle dependencies for these modules
      external(id) {
        // Only externalize Node.js built-ins
        return isBuiltin(id)
      },
    }),
    baseConfig({
      input: `${srcPath}/external/ink-table.mjs`,
      output: {
        file: path.join(path.relative(rootPath, distPath), 'external/ink-table.js'),
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        generatedCode: {
          preset: 'es2015',
          arrowFunctions: true,
          constBindings: true,
          objectShorthand: true
        },
        compact: true,
        sourcemap: false,
        inlineDynamicImports: true,
      },
      // Override external to bundle dependencies for these modules
      external(id) {
        // Only externalize Node.js built-ins
        return isBuiltin(id)
      },
    }),
    baseConfig({
      input: `${srcPath}/external/yoga-layout.mjs`,
      output: {
        file: path.join(path.relative(rootPath, distPath), 'external/yoga-layout.js'),
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        generatedCode: {
          preset: 'es2015',
          arrowFunctions: true,
          constBindings: true,
          objectShorthand: true
        },
        compact: true,
        sourcemap: false,
        inlineDynamicImports: true,
      },
      // Override external to bundle dependencies for these modules
      external(id) {
        // Only externalize Node.js built-ins
        return isBuiltin(id)
      },
    }),
  ]
}
