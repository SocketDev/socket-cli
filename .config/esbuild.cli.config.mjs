/**
 * esbuild configuration for building Socket CLI as a SINGLE unified file.
 *
 * esbuild is much faster than Rollup and doesn't have template literal corruption issues.
 */

import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Get local Socket package paths.
const socketPackages = {
  '@socketsecurity/registry': path.join(
    rootPath,
    '..',
    'socket-registry',
    'registry',
  ),
  '@socketsecurity/sdk': path.join(rootPath, '..', 'socket-sdk-js'),
  '@socketregistry/packageurl-js': path.join(
    rootPath,
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

export default {
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
  },

  // Inject import.meta.url polyfill for CJS.
  inject: [path.join(__dirname, 'esbuild-inject-import-meta.js')],

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
