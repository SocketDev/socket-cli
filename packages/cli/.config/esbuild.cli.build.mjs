/**
 * esbuild configuration for building Socket CLI as a SINGLE unified file.
 *
 * esbuild is much faster than Rollup and doesn't have template literal corruption issues.
 */

import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { unicodeTransformPlugin } from '@socketsecurity/build-infra/lib/esbuild-plugin-unicode-transform'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Read package.json for version and metadata.
const packageJson = JSON.parse(
  readFileSync(path.join(rootPath, 'package.json'), 'utf-8'),
)

// Get current git commit hash.
let gitHash = ''
try {
  gitHash = execSync('git rev-parse --short HEAD', {
    cwd: rootPath,
    encoding: 'utf-8',
  }).trim()
} catch {}

// Get dependency versions from package.json devDependencies.
const coanaVersion = packageJson.devDependencies?.['@coana-tech/cli'] || ''
const cdxgenVersion = packageJson.devDependencies?.['@cyclonedx/cdxgen'] || ''
const synpVersion = packageJson.devDependencies?.['synp'] || ''

// Build-time constants that can be overridden by environment variables.
const publishedBuild = process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] === '1'
const legacyBuild = process.env['INLINED_SOCKET_CLI_LEGACY_BUILD'] === '1'
const sentryBuild = process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'] === '1'

// Compute version hash (matches Rollup implementation).
const randUuidSegment = randomUUID().split('-')[0]
const versionHash = `${packageJson.version}:${gitHash}:${randUuidSegment}${
  publishedBuild ? '' : ':dev'
}`

// Get local Socket package paths using canonical helper.
// rootPath is packages/cli, so go up to socket-cli root for getLocalPackageAliases.
const socketCliRoot = path.join(rootPath, '..', '..')
const distAliases = getLocalPackageAliases(socketCliRoot)

// Convert dist paths to package roots (remove /dist suffix).
const socketPackages = {}
for (const [packageName, distPath] of Object.entries(distAliases)) {
  socketPackages[packageName] = path.dirname(distPath)
}

// Resolve subpath from package.json exports.
function resolvePackageSubpath(packagePath, subpath) {
  try {
    const pkgJsonPath = path.join(packagePath, 'package.json')
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    const exports = pkgJson.exports || {}

    // Try exact export match.
    const exportKey = subpath === '.' ? '.' : `./${subpath}`
    if (exports[exportKey]) {
      const exportValue = exports[exportKey]
      // Handle conditional exports.
      if (typeof exportValue === 'object' && exportValue.default) {
        return path.join(packagePath, exportValue.default)
      }
      // Handle simple string exports.
      if (typeof exportValue === 'string') {
        return path.join(packagePath, exportValue)
      }
    }

    // Fallback: try conventional paths.
    const distPath = path.join(packagePath, 'dist', subpath)
    if (existsSync(`${distPath}.js`)) {
      return `${distPath}.js`
    }
    if (existsSync(`${distPath}.mjs`)) {
      return `${distPath}.mjs`
    }
    if (existsSync(path.join(distPath, 'index.js'))) {
      return path.join(distPath, 'index.js')
    }
    if (existsSync(path.join(distPath, 'index.mjs'))) {
      return path.join(distPath, 'index.mjs')
    }
  } catch {}

  return null
}

const config = {
  entryPoints: [path.join(rootPath, 'src/cli-dispatch.mts')],
  bundle: true,
  outfile: path.join(rootPath, 'build/cli.js'),
  // Target Node.js environment (not browser).
  platform: 'node',
  // Target Node.js 18+ features.
  target: 'node18',
  format: 'cjs',

  // With platform: 'node', esbuild automatically externalizes all Node.js
  // built-ins. The explicit external array with builtinModules is redundant
  // (but doesn't hurt as extra safety).
  external: [
    'node-gyp', // Required for require.resolve('node-gyp/package.json')
  ],

  // Suppress warnings for intentional CommonJS compatibility code.
  logOverride: {
    'commonjs-variable-in-esm': 'silent',
  },

  // Add shebang.
  banner: {
    js: '#!/usr/bin/env node\n"use strict";',
  },

  // Source maps off for production.
  sourcemap: false,

  // Don't minify (keep readable for debugging).
  minify: false,

  // Keep names for better stack traces.
  keepNames: true,

  // Plugin needs to transform output.
  write: false,

  // Define environment variables and import.meta.
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': '__importMetaUrl',
    // Inject build metadata (replaces Rollup replace plugin).
    'process.env.INLINED_SOCKET_CLI_VERSION': JSON.stringify(
      packageJson.version,
    ),
    'process.env.INLINED_SOCKET_CLI_VERSION_HASH': JSON.stringify(versionHash),
    'process.env.INLINED_SOCKET_CLI_NAME': JSON.stringify(packageJson.name),
    'process.env.INLINED_SOCKET_CLI_HOMEPAGE': JSON.stringify(
      packageJson.homepage,
    ),
    'process.env.INLINED_SOCKET_CLI_AI_VERSION': JSON.stringify(
      packageJson.version,
    ),
    'process.env.INLINED_SOCKET_CLI_COANA_VERSION':
      JSON.stringify(coanaVersion),
    'process.env.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION':
      JSON.stringify(cdxgenVersion),
    'process.env.INLINED_SOCKET_CLI_SYNP_VERSION': JSON.stringify(synpVersion),
    'process.env.INLINED_SOCKET_CLI_PUBLISHED_BUILD': JSON.stringify(
      publishedBuild ? '1' : '',
    ),
    'process.env.INLINED_SOCKET_CLI_LEGACY_BUILD': JSON.stringify(
      legacyBuild ? '1' : '',
    ),
    'process.env.INLINED_SOCKET_CLI_SENTRY_BUILD': JSON.stringify(
      sentryBuild ? '1' : '',
    ),
    // Python version/tag are optional and typically empty for standard builds.
    'process.env.INLINED_SOCKET_CLI_PYTHON_VERSION': JSON.stringify(''),
    'process.env.INLINED_SOCKET_CLI_PYTHON_BUILD_TAG': JSON.stringify(''),
  },

  // Inject import.meta.url polyfill for CJS.
  inject: [path.join(__dirname, 'esbuild-inject-import-meta.mjs')],

  // Handle special cases with plugins.
  plugins: [
    unicodeTransformPlugin(),
    {
      name: 'resolve-socket-packages',
      setup(build) {
        // Resolve local Socket packages with subpath exports.
        for (const [packageName, packagePath] of Object.entries(
          socketPackages,
        )) {
          // Handle package root imports.
          build.onResolve(
            { filter: new RegExp(`^${packageName.replace('/', '\\/')}$`) },
            () => {
              if (!existsSync(packagePath)) {
                return null
              }
              const resolved = resolvePackageSubpath(packagePath, '.')
              if (resolved) {
                return { path: resolved }
              }
              return null
            },
          )

          // Handle subpath imports.
          build.onResolve(
            { filter: new RegExp(`^${packageName.replace('/', '\\/')}\\/`) },
            args => {
              if (!existsSync(packagePath)) {
                return null
              }
              const subpath = args.path.slice(packageName.length + 1)
              const resolved = resolvePackageSubpath(packagePath, subpath)
              if (resolved) {
                return { path: resolved }
              }
              return null
            },
          )
        }
      },
    },

    {
      name: 'resolve-socket-lib-internals',
      setup(build) {
        // Helper to find socket-lib directory (either local sibling or node_modules).
        function findSocketLibPath(importerPath) {
          // Try to extract socket-lib base path from the importer.
          const match = importerPath.match(/^(.*\/@socketsecurity\/lib)\b/)
          if (match) {
            return match[1]
          }

          // Fallback to local sibling directory.
          const localPath = path.join(rootPath, '..', '..', '..', 'socket-lib')
          if (existsSync(localPath)) {
            return localPath
          }

          return null
        }

        build.onResolve({ filter: /^\.\.\/constants\// }, args => {
          // Only handle imports from socket-lib's dist directory.
          if (!args.importer.includes('/socket-lib/dist/')) {
            return null
          }

          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }

          const constantName = args.path.replace(/^\.\.\/constants\//, '')
          const resolvedPath = path.join(
            socketLibPath,
            'dist',
            'constants',
            `${constantName}.js`,
          )
          if (existsSync(resolvedPath)) {
            return { path: resolvedPath }
          }
          return null
        })

        build.onResolve({ filter: /^\.\.\/\.\.\/constants\// }, args => {
          // Handle ../../constants/ imports.
          if (!args.importer.includes('/socket-lib/dist/')) {
            return null
          }

          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }

          const constantName = args.path.replace(/^\.\.\/\.\.\/constants\//, '')
          const resolvedPath = path.join(
            socketLibPath,
            'dist',
            'constants',
            `${constantName}.js`,
          )
          if (existsSync(resolvedPath)) {
            return { path: resolvedPath }
          }
          return null
        })

        // Resolve external dependencies that socket-lib bundles in dist/external/.
        // Automatically handles any bundled dependency (e.g., @inquirer/*, zod, semver).
        build.onResolve({ filter: /^(@[^/]+\/[^/]+|[^./][^/]*)/ }, args => {
          if (!args.importer.includes('/socket-lib/dist/')) {
            return null
          }

          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }

          // Extract package name (handle scoped packages).
          const packageName = args.path.startsWith('@')
            ? args.path.split('/').slice(0, 2).join('/')
            : args.path.split('/')[0]

          // Check if this package has a bundled version in dist/external/.
          let resolvedPath = null
          if (packageName.startsWith('@')) {
            // Scoped package like @inquirer/confirm.
            const [scope, name] = packageName.split('/')
            const scopedPath = path.join(
              socketLibPath,
              'dist',
              'external',
              scope,
              `${name}.js`,
            )
            if (existsSync(scopedPath)) {
              resolvedPath = scopedPath
            }
          } else {
            // Regular package like zod, semver, etc.
            const regularPath = path.join(
              socketLibPath,
              'dist',
              'external',
              `${packageName}.js`,
            )
            if (existsSync(regularPath)) {
              resolvedPath = regularPath
            }
          }

          if (resolvedPath) {
            return { path: resolvedPath }
          }

          return null
        })
      },
    },

    {
      name: 'yoga-wasm-alias',
      setup(build) {
        // Redirect yoga-layout to our custom synchronous implementation.
        build.onResolve({ filter: /^yoga-layout$/ }, () => {
          return {
            path: path.join(rootPath, 'build/yoga-sync.mjs'),
          }
        })
      },
    },

    {
      name: 'stub-problematic-packages',
      setup(build) {
        // Stub iconv-lite and encoding to avoid bundling issues.
        build.onResolve({ filter: /^(iconv-lite|encoding)(\/|$)/ }, args => {
          return {
            path: args.path,
            namespace: 'stub',
          }
        })

        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
          return {
            contents: 'module.exports = {}',
            loader: 'js',
          }
        })
      },
    },

    {
      name: 'ignore-unsupported-files',
      setup(build) {
        // Ignore .cs files and other non-JS files.
        build.onResolve({ filter: /\.(cs|node-gyp)$/ }, () => {
          return { path: '/dev/null', external: true }
        })
      },
    },
  ],
}

// Run build if invoked directly.
// Use fileURLToPath to handle Windows paths correctly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config)
    .then(result => {
      // Write the transformed output (build had write: false).
      if (result.outputFiles && result.outputFiles.length > 0) {
        for (const output of result.outputFiles) {
          writeFileSync(output.path, output.contents)
        }
      }
    })
    .catch(error => {
      console.error('Build failed:', error)
      process.exitCode = 1
    })
}

export default config
