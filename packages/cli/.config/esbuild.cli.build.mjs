/**
 * esbuild configuration for building Socket CLI as a SINGLE unified file.
 *
 * esbuild is much faster than Rollup and doesn't have template literal corruption issues.
 */

import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// Get local Socket package paths.
const socketPackages = {
  '@socketsecurity/lib': path.join(rootPath, '..', '..', '..', 'socket-lib'),
  '@socketsecurity/registry': path.join(
    rootPath,
    '..',
    '..',
    '..',
    'socket-registry',
    'registry',
  ),
  '@socketsecurity/sdk': path.join(rootPath, '..', '..', '..', 'socket-sdk-js'),
  '@socketregistry/packageurl-js': path.join(
    rootPath,
    '..',
    '..',
    '..',
    'socket-packageurl-js',
  ),
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
  outfile: path.join(rootPath, 'dist/cli.js'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',

  // Externalize Node.js built-ins.
  external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)],

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
    'process.env.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION':
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
        // Resolve relative imports from socket-lib dist files.
        const socketLibPath = path.join(rootPath, '..', '..', '..', 'socket-lib')
        if (existsSync(socketLibPath)) {
          build.onResolve({ filter: /^\.\.\/constants\// }, args => {
            // Only handle imports from socket-lib's dist directory.
            if (args.importer.includes('/socket-lib/dist/')) {
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
            }
            return null
          })

          build.onResolve({ filter: /^\.\.\/\.\.\/constants\// }, args => {
            // Handle ../../constants/ imports.
            if (args.importer.includes('/socket-lib/dist/')) {
              const constantName = args.path.replace(
                /^\.\.\/\.\.\/constants\//,
                '',
              )
              const resolvedPath = path.join(
                socketLibPath,
                'dist',
                'constants',
                `${constantName}.js`,
              )
              if (existsSync(resolvedPath)) {
                return { path: resolvedPath }
              }
            }
            return null
          })
        }
      },
    },

    {
      name: 'yoga-wasm-alias',
      setup(build) {
        // Redirect yoga-layout to our custom synchronous implementation.
        build.onResolve({ filter: /^yoga-layout$/ }, () => {
          return {
            path: path.join(rootPath, 'external/yoga-sync.mjs'),
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
if (import.meta.url === `file://${process.argv[1]}`) {
  build(config).catch(error => {
    console.error('Build failed:', error)
    process.exitCode = 1
  })
}

export default config
