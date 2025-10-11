/**
 * Rollup configuration for building Socket CLI as SEA-ready single files.
 *
 * This creates single-file builds for each CLI entry point that are suitable
 * for SEA packaging, even when not actually creating a SEA binary.
 *
 * Each output file includes the main logic bundled together, with external
 * dependencies kept separate (similar to the original build but organized
 * as single files per entry point).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
import { purgePolyfills } from 'unplugin-purge-polyfills'

import { readPackageJsonSync } from '@socketsecurity/registry/lib/packages'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants from '../scripts/constants.mjs'
import { isBuiltin } from '../scripts/utils/packages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Get package.json for version info.
let _rootPkgJson
function getRootPkgJsonSync() {
  if (_rootPkgJson === undefined) {
    _rootPkgJson = readPackageJsonSync(constants.rootPath, { normalize: true })
  }
  return _rootPkgJson
}

// Generate unique version hash for builds.
let _socketVersionHash
function getSocketCliVersionHash() {
  if (_socketVersionHash === undefined) {
    const randUuidSegment = randomUUID().split('-')[0]
    const { version } = getRootPkgJsonSync()
    let gitHash = ''
    try {
      gitHash = stripAnsi(
        spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
          encoding: 'utf8',
        }).stdout.trim(),
      )
    } catch {}
    _socketVersionHash = `${version}:${gitHash}:${randUuidSegment}${
      constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD ? '' : ':dev'
    }`
  }
  return _socketVersionHash
}

// Copy package files for distribution.
async function copyPublishFiles() {
  // Determine which package.json to use based on build variant.
  let packageJsonSource
  if (constants.ENV.INLINED_SOCKET_CLI_LEGACY_BUILD) {
    packageJsonSource = path.join(
      constants.rootPath,
      '.config/packages/package.cli-legacy.json',
    )
  } else if (constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD) {
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

  // Write package.json to dist.
  const distPackageJsonPath = path.join(constants.distPath, 'package.json')
  await fs.writeFile(
    distPackageJsonPath,
    JSON.stringify(sourcePkgJson, null, 2) + '\n',
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

  // Copy additional files needed for CLI.
  const filepath = path.join(constants.srcPath, 'commands/manifest/init.gradle')
  const destPath = path.join(constants.distPath, 'init.gradle')
  await fs.copyFile(filepath, destPath)

  const bashCompletionPath = path.join(
    constants.srcPath,
    'commands/install/socket-completion.bash',
  )
  const bashDestPath = path.join(constants.distPath, 'socket-completion.bash')
  await fs.copyFile(bashCompletionPath, bashDestPath)
}

// Create the base plugins array that all configs will use.
function createBasePlugins() {
  return [
    // Replace environment variables.
    replacePlugin({
      preventAssignment: true,
      delimiters: ['(?<![\'"])\\b', '(?![\'"])'],
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.INLINED_SOCKET_CLI_VERSION': JSON.stringify(
          getRootPkgJsonSync().version,
        ),
        'process.env.INLINED_SOCKET_CLI_VERSION_HASH': JSON.stringify(
          getSocketCliVersionHash(),
        ),
        'process.env.INLINED_SOCKET_CLI_HOMEPAGE': JSON.stringify(
          getRootPkgJsonSync().homepage,
        ),
        'process.env.INLINED_SOCKET_CLI_NAME': JSON.stringify(
          getRootPkgJsonSync().name,
        ),
        'process.env.INLINED_SOCKET_CLI_PUBLISHED_BUILD': JSON.stringify(
          !!constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD,
        ),
        'process.env.INLINED_SOCKET_CLI_LEGACY_BUILD': JSON.stringify(
          !!constants.ENV.INLINED_SOCKET_CLI_LEGACY_BUILD,
        ),
        'process.env.INLINED_SOCKET_CLI_SENTRY_BUILD': JSON.stringify(
          !!constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD,
        ),
        'process.env.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION': JSON.stringify(
          getRootPkgJsonSync().devDependencies['@coana-tech/cli'],
        ),
        'process.env.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION':
          JSON.stringify(
            getRootPkgJsonSync().devDependencies['@cyclonedx/cdxgen'],
          ),
        'process.env.INLINED_SOCKET_CLI_SYNP_VERSION': JSON.stringify(
          getRootPkgJsonSync().devDependencies['synp'],
        ),
        'process.env.INLINED_SOCKET_CLI_PYTHON_VERSION':
          JSON.stringify('3.10.18'),
        'process.env.INLINED_SOCKET_CLI_PYTHON_BUILD_TAG':
          JSON.stringify('20250918'),
      },
    }),

    // Resolve node modules.
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node'],
      extensions: ['.mjs', '.js', '.json', '.ts', '.mts'],
    }),

    // Handle JSON imports.
    jsonPlugin(),

    // Transform TypeScript and modern JS.
    babelPlugin({
      babelHelpers: 'runtime',
      babelrc: false,
      configFile: path.join(__dirname, 'babel.config.js'),
      extensions: ['.mts', '.ts', '.mjs', '.js'],
      exclude: [
        'node_modules/**',
        '**/*.d.ts',
        '**/*.d.mts',
        '**/*.d.cts',
        '**/src/utils/ink.d.mts',
      ],
    }),

    // Convert CommonJS modules.
    commonjsPlugin({
      defaultIsModuleExports: true,
      extensions: ['.cjs', '.js'],
      ignoreDynamicRequires: true,
      ignoreGlobal: true,
      ignoreTryCatch: true,
      strictRequires: true,
    }),

    // Purge unnecessary polyfills.
    purgePolyfills.rollup({
      replacements: {},
    }),
  ]
}

// Create a configuration for each entry point.
function createEntryConfig(entryName, inputPath) {
  const outputFileName = `${entryName}.js`

  return {
    input: inputPath,
    output: {
      file: path.join(constants.distPath, outputFileName),
      format: 'cjs',
      // Bundle the main logic together.
      inlineDynamicImports: true,
      interop: 'auto',
      // Create source maps for debugging.
      sourcemap: true,
      sourcemapDebugIds: true,
    },
    // Externalize dependencies like the original build does.
    external(id) {
      // Always externalize Node.js built-ins.
      if (isBuiltin(id)) {
        return true
      }

      // Externalize TypeScript declaration files - they shouldn't be imported anyway.
      if (
        id.endsWith('.d.ts') ||
        id.endsWith('.d.mts') ||
        id.endsWith('.d.cts')
      ) {
        return true
      }

      // Also skip any path that contains .d.mts anywhere
      if (id.includes('.d.mts')) {
        return true
      }

      // Externalize @socketsecurity packages to keep them separate.
      if (id.startsWith('@socketsecurity/')) {
        return true
      }

      // Externalize other major dependencies to keep file sizes manageable.
      if (
        id.startsWith('blessed') ||
        id.startsWith('blessed-contrib') ||
        id.startsWith('@babel/runtime')
      ) {
        return true
      }

      // Bundle everything else.
      return false
    },
    // Disable tree-shaking to prevent incorrect removal of code.
    treeshake: false,
    plugins: createBasePlugins(),

    // Suppress certain warnings.
    onwarn(warning, warn) {
      if (
        warning.code === 'EVAL' ||
        warning.code === 'CIRCULAR_DEPENDENCY' ||
        warning.code === 'THIS_IS_UNDEFINED' ||
        warning.code === 'UNRESOLVED_IMPORT' ||
        warning.code === 'INVALID_ANNOTATION'
      ) {
        return // Suppress these warnings.
      }
      warn(warning)
    },
  }
}

// Export configuration for all entry points.
export default async () => {
  const { srcPath } = constants

  // Define all entry points.
  const entryPoints = [
    ['cli', `${srcPath}/cli.mts`],
    ['npm-cli', `${srcPath}/npm-cli.mts`],
    ['npx-cli', `${srcPath}/npx-cli.mts`],
    ['pnpm-cli', `${srcPath}/pnpm-cli.mts`],
    ['yarn-cli', `${srcPath}/yarn-cli.mts`],
  ]

  // Add additional entries for specific build types.
  if (constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD) {
    entryPoints.push([
      'instrument-with-sentry',
      `${srcPath}/instrument-with-sentry.mts`,
    ])
  }

  // Shadow entries for npm/npx/pnpm/yarn wrapping.
  entryPoints.push(
    ['shadow-npm-bin', `${srcPath}/shadow/npm/bin.mts`],
    ['shadow-npm-inject', `${srcPath}/shadow/npm/inject.mts`],
    ['shadow-npx-bin', `${srcPath}/shadow/npx/bin.mts`],
    ['shadow-pnpm-bin', `${srcPath}/shadow/pnpm/bin.mts`],
    ['shadow-yarn-bin', `${srcPath}/shadow/yarn/bin.mts`],
  )

  // Constants and utilities that are commonly shared.
  entryPoints.push(
    ['constants', `${srcPath}/constants.mts`],
    ['flags', `${srcPath}/flags.mts`],
  )

  // Create configurations for each entry point.
  const configs = entryPoints.map(([name, path]) =>
    createEntryConfig(name, path),
  )

  // Add a plugin to the first config to copy publish files after build.
  configs[0].plugins.push({
    async writeBundle() {
      await copyPublishFiles()
    },
  })

  return configs
}
