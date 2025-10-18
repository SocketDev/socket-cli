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
import { transform as esbuildTransform } from 'esbuild'


import fixDebug from './rollup-plugin-fix-debug.mjs'
import fixInk from './rollup-plugin-fix-ink.mjs'
import fixYoga from './rollup-plugin-fix-yoga.mjs'
import { generateReplacePatterns } from './rollup-replace-patterns.mjs'
import {
  createCleanupPlugins,
  standardOnwarn,
} from './rollup-shared-plugins.mjs'
import constants from './rollup.cli-js.constants.mjs'
import { rootPath } from '../scripts/constants/paths.mjs'
import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

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
    if (existsSync(`${indexPath}.js`)) {
      return `${indexPath}.js`
    }
    if (existsSync(`${indexPath}.mjs`)) {
      return `${indexPath}.mjs`
    }
  }

  // For subpaths, try dist/subpath.
  const baseResolved = path.join(packagePath, 'dist', subpath)
  if (existsSync(`${baseResolved}.js`)) {
    return `${baseResolved}.js`
  }
  if (existsSync(`${baseResolved}.mjs`)) {
    return `${baseResolved}.mjs`
  }
  if (existsSync(path.join(baseResolved, 'index.js'))) {
    return path.join(baseResolved, 'index.js')
  }
  if (existsSync(path.join(baseResolved, 'index.mjs'))) {
    return path.join(baseResolved, 'index.mjs')
  }

  return null
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
  input: path.join(constants.srcPath, 'cli-dispatch.mts'),
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
  // Externalize Node.js built-ins only.
  // Other problematic packages are handled by stub plugins.
  external(id) {
    return isBuiltin(id)
  },
  // Disable tree-shaking to ensure all code paths are included.
  treeshake: false,
  plugins: [
    // FIRST: Redirect ajv to ajv-dist (pre-bundled version).
    {
      name: 'alias-ajv-to-ajv-dist',
      resolveId(source, _importer, options) {
        if (source === 'ajv') {
          // Redirect ajv imports to ajv-dist by resolving it through the resolution chain.
          return this.resolve('ajv-dist', _importer, {
            ...options,
            skipSelf: true,
          })
        }
        return null
      },
    },

    // Redirect yoga-layout to our custom synchronous implementation.
    {
      name: 'alias-yoga-layout-to-sync',
      resolveId(source, _importer, _options) {
        if (source === 'yoga-layout') {
          const resolved = path.join(constants.rootPath, 'external/yoga-sync.mjs')
          console.log(`[alias-yoga] Resolving 'yoga-layout' to:`, resolved)
          // Use our custom synchronous loader with yoga's WASM and wrapAssembly.
          return { id: resolved, external: false }
        }
        return null
      },
    },

    // Replace iconv-lite and encoding with stubs to avoid bundling issues.
    {
      name: 'stub-problematic-packages',
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
          if (source.startsWith(`${packageName}/`)) {
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

    // Replace environment variables and import.meta.
    replacePlugin({
      delimiters: ['', ''],
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        ...generateReplacePatterns(),
      },
    }),

    // Resolve node modules - bundle ALL dependencies.
    nodeResolve({
      alias: getLocalPackageAliases(rootPath),
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
      // Don't throw on dynamic requires - let them pass through EXCEPT for ajv.
      ignoreDynamicRequires: id => {
        // Force ajv requires to be resolved, not ignored.
        if (id.includes('node_modules/ajv')) {
          return false
        }
        return true
      },
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
        '**/yargs-parser/**',
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

    // Shared cleanup plugins (from rollup-shared-plugins.mjs).
    ...createCleanupPlugins(),

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
        // Fix import.meta transformation - replace empty objects assigned from import.meta.
        // Pattern: var SomeName = {}; where it should be import.meta.
        // The fix: Since we're in CommonJS, import.meta.url should resolve to require.main.filename or __filename.
        // Replace patterns like: me = ne.createRequire ? (0, ne.createRequire)(Ve.url) : void 0
        // Where Ve = {} is the transformed import.meta.
        cleaned = cleaned.replace(
          /(\w+)\.createRequire\s*\?\s*\(\s*0\s*,\s*\1\.createRequire\s*\)\s*\(\s*(\w+)\.url\s*\)\s*:\s*void\s+0/g,
          '$1.createRequire ? (0, $1.createRequire)(__filename) : void 0',
        )
        return cleaned
      },
    },

    // Minify the final bundle with esbuild (unless --no-minify is set).
    ...(process.env.SOCKET_CLI_NO_MINIFY
      ? []
      : [
          {
            name: 'esbuild-minify',
            async renderChunk(code) {
              const result = await esbuildTransform(code, {
                loader: 'js',
                minify: true,
                minifyWhitespace: true,
                minifyIdentifiers: true,
                minifySyntax: true,
                target: 'node22',
                format: 'cjs',
                platform: 'node',
                logLevel: 'silent',
                // Preserve shebang and "use strict" from banner.
                legalComments: 'inline',
                // Keep function names for better stack traces.
                keepNames: false,
              })

              const minified = result.code
              const originalSize = Buffer.byteLength(code, 'utf8')
              const minifiedSize = Buffer.byteLength(minified, 'utf8')
              const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(
                1,
              )

              console.log(
                `✓ Minified dist/cli.js: ${(originalSize / 1024).toFixed(1)}KB → ${(minifiedSize / 1024).toFixed(1)}KB (-${savings}%)`,
              )

              return minified
            },
          },
        ]),
  ],

  // Suppress warnings.
  onwarn: standardOnwarn,

  // Watch mode configuration for development
  watch: {
    include: 'src/**',
    exclude: ['node_modules/**', 'dist/**', 'test/**'],
    chokidar: {
      // Use native FSEvents on macOS for better performance
      useFsEvents: process.platform === 'darwin',
      // Ignore dotfiles
      ignored: /(^|[/\\])\../,
    },
    // Clear screen on rebuild
    clearScreen: false,
  },

  // Enable caching for faster subsequent builds
  cache: true,

  // Optimize parallel processing
  maxParallelFileOps: 20,
}
