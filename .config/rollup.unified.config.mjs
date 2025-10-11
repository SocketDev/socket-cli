/**
 * Rollup configuration for building Socket CLI as a SINGLE unified file.
 *
 * This creates one file that contains ALL code and dependencies (except Node.js built-ins).
 * The resulting file can detect how it was invoked and behave as any of the CLI commands.
 * Perfect for SEA packaging and single-file distribution.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'

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

export default {
  input: path.join(constants.srcPath, 'unified-cli.mts'),
  output: {
    file: path.join(constants.distPath, 'socket-unified.js'),
    format: 'cjs',
    // Bundle everything into one file.
    inlineDynamicImports: true,
    interop: 'auto',
    // Include shebang for executable.
    banner: '#!/usr/bin/env node\n"use strict";',
    // Don't create source maps for the unified build to keep it simple.
    sourcemap: false,
  },
  // Only externalize Node.js built-ins - bundle EVERYTHING else.
  external(id) {
    return isBuiltin(id)
  },
  // Disable tree-shaking to ensure all code paths are included.
  treeshake: false,
  plugins: [
    // Replace environment variables.
    replacePlugin({
      preventAssignment: true,
      delimiters: ['(?<![\'"])\\b', '(?![\'"])'],
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.INLINED_SOCKET_CLI_UNIFIED_BUILD': JSON.stringify('1'),
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

    // Resolve node modules - bundle ALL dependencies.
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node'],
      extensions: ['.mjs', '.js', '.json', '.ts', '.mts'],
      // Bundle ALL dependencies, not just some.
      resolveOnly: [/.*/],
    }),

    // Handle JSON imports.
    jsonPlugin(),

    // Transform TypeScript and modern JS.
    babelPlugin({
      babelHelpers: 'runtime', // Use runtime helpers as required by babel config.
      babelrc: false,
      configFile: path.join(__dirname, 'babel.config.js'),
      extensions: ['.mts', '.ts', '.mjs', '.js'],
      exclude: [
        '**/*.d.ts',
        '**/*.d.mts',
        '**/*.d.cts',
        '**/test/**',
        '**/tests/**',
        '**/*.test.*',
        '**/*.spec.*',
        '**/fixtures/**',
      ],
    }),

    // Convert CommonJS modules.
    commonjsPlugin({
      defaultIsModuleExports: true,
      extensions: ['.cjs', '.js'],
      ignoreDynamicRequires: true,
      ignoreGlobal: false,
      ignoreTryCatch: true,
      strictRequires: false,
      // Exclude test files and fixtures.
      exclude: [
        '**/test/**',
        '**/tests/**',
        '**/*.test.js',
        '**/*.spec.js',
        '**/fixtures/**',
      ],
    }),

    // Custom plugin to handle blessed and other special cases.
    {
      name: 'handle-special-cases',
      resolveId(source, importer) {
        // Skip test imports entirely.
        if (
          source.includes('/test/') ||
          source.includes('/tests/') ||
          source.includes('@socketsecurity/registry/test/')
        ) {
          return { id: source, external: true }
        }
        return null
      },
      transform(code, id) {
        // Fix blessed library octal escape sequences.
        if (
          id.includes('blessed') &&
          (id.includes('tput.js') || id.includes('box.js'))
        ) {
          return code
            .replace(/ch = '\\200';/g, "ch = '\\x80';")
            .replace(/'\\016'/g, "'\\x0E'")
            .replace(/'\\017'/g, "'\\x0F'")
        }

        // Skip problematic test fixtures.
        if (id.includes('/fixtures/') || id.includes('/test/')) {
          return 'export default {}; export {};'
        }

        return null
      },
    },

    // Final cleanup plugin.
    {
      name: 'final-cleanup',
      renderChunk(code) {
        // Remove any remaining require calls to test modules.
        return code.replace(/require\(['"].*?\/test\/.*?['"]\)/g, '({})')
      },
    },
  ],

  // Suppress warnings.
  onwarn(warning, warn) {
    if (
      warning.code === 'EVAL' ||
      warning.code === 'CIRCULAR_DEPENDENCY' ||
      warning.code === 'THIS_IS_UNDEFINED' ||
      warning.code === 'UNRESOLVED_IMPORT' ||
      warning.code === 'INVALID_ANNOTATION' ||
      warning.code === 'MISSING_EXPORT' ||
      warning.code === 'MIXED_EXPORTS'
    ) {
      return // Suppress these warnings.
    }
    warn(warning)
  },
}
