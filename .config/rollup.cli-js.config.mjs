/**
 * Rollup configuration for building Socket CLI as a SINGLE unified file.
 *
 * This creates one file that contains ALL code and dependencies (except Node.js built-ins).
 * The resulting file can detect how it was invoked and behave as any of the CLI commands.
 * Perfect for SEA packaging and single-file distribution.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs, { existsSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'

import fixDebug from './rollup-plugin-fix-debug.mjs'
import fixInk from './rollup-plugin-fix-ink.mjs'
import fixYoga from './rollup-plugin-fix-yoga.mjs'
import constants from './rollup.cli-js.constants.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cache for package.json exports objects.
const packageExportsCache = {
  __proto__: null,
}

// Read and cache package.json exports for a socket package.
function getPackageExports(packagePath) {
  if (packageExportsCache[packagePath]) {
    return packageExportsCache[packagePath]
  }
  try {
    const pkgJsonPath = path.join(packagePath, 'package.json')
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    packageExportsCache[packagePath] = pkgJson.exports || {}
    return packageExportsCache[packagePath]
  } catch {
    packageExportsCache[packagePath] = {}
    return {}
  }
}

// Resolve a subpath using package.json exports.
function resolveFromExports(packagePath, subpath) {
  const exports = getPackageExports(packagePath)
  // Package root uses "." as the export key.
  const exportKey = subpath === '.' ? '.' : `./${subpath}`

  if (exports[exportKey]) {
    const exportValue = exports[exportKey]
    // Handle conditional exports { default: "...", types: "..." }.
    if (typeof exportValue === 'object' && exportValue.default) {
      return path.join(packagePath, exportValue.default)
    }
    // Handle simple string exports.
    if (typeof exportValue === 'string') {
      return path.join(packagePath, exportValue)
    }
  }

  // Fallback: try conventional paths.
  // For package root, try dist/index.
  if (subpath === '.') {
    const indexPath = path.join(packagePath, 'dist', 'index')
    if (existsSync(indexPath + '.js')) {
      return indexPath + '.js'
    }
    if (existsSync(indexPath + '.mjs')) {
      return indexPath + '.mjs'
    }
  }

  // For subpaths, try dist/subpath.
  const baseResolved = path.join(packagePath, 'dist', subpath)
  if (existsSync(baseResolved + '.js')) {
    return baseResolved + '.js'
  }
  if (existsSync(baseResolved + '.mjs')) {
    return baseResolved + '.mjs'
  }
  if (existsSync(path.join(baseResolved, 'index.js'))) {
    return path.join(baseResolved, 'index.js')
  }
  if (existsSync(path.join(baseResolved, 'index.mjs'))) {
    return path.join(baseResolved, 'index.mjs')
  }

  return null
}

// Inline getLocalPackageAliases to avoid importing from registry.
function getLocalPackageAliases() {
  const aliases = {}
  const rootDir = constants.rootPath

  // Check for ../socket-registry/registry.
  const registryPath = path.join(rootDir, '..', 'socket-registry', 'registry')
  if (existsSync(path.join(registryPath, 'package.json'))) {
    aliases['@socketsecurity/registry'] = registryPath
  }

  // Check for ../socket-packageurl-js.
  const packageurlPath = path.join(rootDir, '..', 'socket-packageurl-js')
  if (existsSync(path.join(packageurlPath, 'package.json'))) {
    aliases['@socketregistry/packageurl-js'] = packageurlPath
  }

  // Check for ../socket-sdk-js.
  const sdkPath = path.join(rootDir, '..', 'socket-sdk-js')
  if (existsSync(path.join(sdkPath, 'package.json'))) {
    aliases['@socketsecurity/sdk'] = sdkPath
  }

  return aliases
}

// Get package.json for version info.
let _rootPkgJson
function getRootPkgJsonSync() {
  if (_rootPkgJson === undefined) {
    const pkgPath = path.join(constants.rootPath, 'package.json')
    _rootPkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
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
      const result = nodeSpawnSync('git', ['rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
      })
      if (result.status === 0) {
        // Strip ANSI codes: simple regex for common escape sequences.
        // eslint-disable-next-line no-control-regex
        gitHash = result.stdout.trim().replace(/\x1b\[[0-9;]*m/g, '')
      }
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
    file: path.join(constants.distPath, 'cli.js'),
    format: 'cjs',
    // Bundle everything into one file.
    inlineDynamicImports: true,
    interop: 'auto',
    // Include shebang for executable.
    banner: '#!/usr/bin/env node\n"use strict";',
    // Don't create source maps for the unified build to keep it simple.
    sourcemap: false,
  },
  // Externalize Node.js built-ins and problematic packages.
  // iconv-lite and encoding cause CommonJS parsing issues with large data tables.
  external(id) {
    return (
      isBuiltin(id) ||
      id === 'iconv-lite' ||
      id.startsWith('iconv-lite/') ||
      id === 'encoding' ||
      id.startsWith('encoding/')
    )
  },
  // Disable tree-shaking to ensure all code paths are included.
  treeshake: false,
  plugins: [
    // FIRST: Replace iconv-lite and encoding with stubs to avoid bundling issues.
    {
      name: 'stub-iconv-encoding',
      resolveId(source) {
        if (
          source === 'iconv-lite' ||
          source.startsWith('iconv-lite/') ||
          source === 'encoding' ||
          source.startsWith('encoding/')
        ) {
          // Return a virtual module ID that we'll handle in load hook.
          return `\0stub:${source}`
        }
        return null
      },
      load(id) {
        if (id.startsWith('\0stub:')) {
          // Return an empty stub module.
          return 'export default {};'
        }
        return null
      },
    },

    // Fix package-specific issues BEFORE replace plugin runs.
    fixDebug(),
    fixInk(),
    fixYoga(),

    // Custom plugin to force bundling of socket packages.
    {
      name: 'force-bundle-socket-packages',
      resolveId(source, _importer, _options) {
        // Define socket packages and their local paths.
        const socketPackages = {
          __proto__: null,
          '@socketsecurity/registry': path.join(
            constants.rootPath,
            '..',
            'socket-registry',
            'registry',
          ),
          '@socketsecurity/sdk': path.join(
            constants.rootPath,
            '..',
            'socket-sdk-js',
          ),
          '@socketregistry/packageurl-js': path.join(
            constants.rootPath,
            '..',
            'socket-packageurl-js',
          ),
        }

        // Handle package root imports (e.g., '@socketsecurity/registry').
        if (socketPackages[source]) {
          const packagePath = socketPackages[source]
          const resolved = resolveFromExports(packagePath, '.')
          if (resolved) {
            return { id: resolved, external: false }
          }
        }

        // Handle subpath imports (e.g., '@socketsecurity/registry/lib/debug').
        for (const [packageName, packagePath] of Object.entries(
          socketPackages,
        )) {
          if (source.startsWith(packageName + '/')) {
            const subpath = source.slice(packageName.length + 1)
            const resolved = resolveFromExports(packagePath, subpath)
            if (resolved) {
              return { id: resolved, external: false }
            }
          }
        }

        return null
      },
    },

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
      alias: getLocalPackageAliases(),
      dedupe: [
        '@socketsecurity/registry',
        '@socketsecurity/sdk',
        '@socketregistry/packageurl-js',
      ],
      preferBuiltins: true,
      exportConditions: ['default', 'node'],
      extensions: ['.mjs', '.js', '.json', '.ts', '.mts', '.tsx'],
      // Look in parent directory for local packages first.
      rootDir: path.join(constants.rootPath, '..'),
      // Resolve/bundle everything (not just certain packages).
      resolveOnly: _module => {
        // Bundle everything except what external() function handles.
        return true
      },
    }),

    // Handle JSON imports.
    jsonPlugin(),

    // Convert CommonJS modules.
    commonjsPlugin({
      // Return module.exports as the default export for CJS modules.
      defaultIsModuleExports: true,
      // Process .cjs and .js files.
      extensions: ['.cjs', '.js'],
      // How to handle ESM external dependencies - false means treat as CJS.
      esmExternals: false,
      // Control what's returned when requiring an ES module from CJS.
      // 'auto' will intelligently handle both default and named exports.
      requireReturnsDefault: 'auto',
      // Don't throw on dynamic requires - let them pass through.
      ignoreDynamicRequires: true,
      // Leave requires in try-catch blocks as-is (for optional deps).
      ignoreTryCatch: true,
      // Don't add "use strict" to transformed CommonJS modules (we have one at the top).
      strictRequires: false,
      // Exclude test files, fixtures, meow (already ESM), and files named dependencies.js.
      exclude: [
        '**/test/**',
        '**/tests/**',
        '**/*.test.js',
        '**/*.spec.js',
        '**/fixtures/**',
        '**/dependencies.js',
        '**/iconv-lite/**',
        '**/encoding/**',
      ],
    }),

    // Transform TypeScript and modern JS.
    babelPlugin({
      babelHelpers: 'runtime', // Use runtime helpers as required by babel config.
      babelrc: false,
      configFile: path.join(__dirname, 'babel.config.js'),
      extensions: ['.mts', '.ts', '.mjs', '.js', '.tsx'],
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

    // Custom plugin to handle special cases.
    {
      name: 'handle-special-cases',
      resolveId(source, _importer, _options) {
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
        let cleaned = code.replace(/require\(['"].*?\/test\/.*?['"]\)/g, '({})')
        // Remove duplicate "use strict" directives (keep only the banner's).
        // Find first "use strict" and preserve it, remove all others.
        let firstUseStrict = true
        cleaned = cleaned.replace(/^\s*['"]use strict['"];?\s*$/gm, match => {
          if (firstUseStrict) {
            firstUseStrict = false
            return match
          }
          return ''
        })
        return cleaned
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
