/**
 * esbuild configuration for building Socket CLI as a SINGLE unified file.
 *
 * esbuild is much faster than Rollup and doesn't have template literal corruption issues.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { IMPORT_META_URL_BANNER } from 'build-infra/lib/esbuild-helpers'
import { unicodeTransformPlugin } from 'build-infra/lib/esbuild-plugin-unicode-transform'

import {
  createBuildRunner,
  createDefineEntries,
  envVarReplacementPlugin,
  getInlinedEnvVars,
} from '../scripts/esbuild-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Get all inlined environment variables from shared utility.
const inlinedEnvVars = getInlinedEnvVars()

// Regex pattern for matching relative paths to socket-lib's external/ directory.
// Matches ./external/, ../external/, ../../external/, etc.
// Supports both forward slashes (Unix/Mac) and backslashes (Windows).
const socketLibExternalPathRegExp = /^(?:\.[/\\]|(?:\.\.[/\\])+)external[/\\]/

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

const config = {
  entryPoints: [path.join(rootPath, 'src/cli-dispatch.mts')],
  bundle: true,
  outfile: path.join(rootPath, 'build/cli.js'),
  // Target Node.js environment (not browser).
  platform: 'node',
  // Target Node.js 18+ features.
  target: 'node18',
  format: 'cjs',

  // With platform: 'node', esbuild automatically externalizes all Node.js built-ins.
  external: [],

  // Suppress warnings for intentional CommonJS compatibility code.
  logOverride: {
    'commonjs-variable-in-esm': 'silent',
    // Suppress warnings about require.resolve for node-gyp (it's external).
    'require-resolve-not-external': 'silent',
  },

  // Add loader for .cs files (node-gyp on Windows).
  loader: {
    '.cs': 'empty',
  },

  // Source maps off for production.
  sourcemap: false,

  // Don't minify (keep readable for debugging).
  minify: false,

  // Keep names for better stack traces.
  keepNames: true,

  // Plugin needs to transform output.
  write: false,

  // Generate metafile for debugging.
  metafile: true,

  // Define environment variables and import.meta.
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': '__importMetaUrl',
    // Inject build metadata using shared utility.
    ...createDefineEntries(inlinedEnvVars),
  },

  // Add shebang and import.meta.url polyfill at top of bundle.
  banner: {
    js: `#!/usr/bin/env node\n"use strict";\n${IMPORT_META_URL_BANNER.js}`,
  },

  // Handle special cases with plugins.
  plugins: [
    unicodeTransformPlugin(),
    // Environment variable replacement must run AFTER unicode transform.
    envVarReplacementPlugin(inlinedEnvVars),
    {
      name: 'resolve-socket-lib-internals',
      setup(build) {
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

        // Resolve relative paths to socket-lib's external/ directory.
        // Handles ./external/, ../external/, ../../external/, etc.
        // Supports both forward slashes and backslashes for cross-platform compatibility.
        // This supports any nesting depth in socket-lib's dist/ directory structure.
        build.onResolve({ filter: socketLibExternalPathRegExp }, args => {
          // Only handle imports from socket-lib's dist directory.
          if (!args.importer.includes('@socketsecurity/lib/dist/')) {
            return null
          }

          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }

          // Extract the package path after the relative prefix and external/, and remove .js extension.
          // Handles both forward slashes and backslashes.
          const externalPath = args.path
            .replace(socketLibExternalPathRegExp, '')
            .replace(/\.js$/, '')

          // Build the resolved path to socket-lib's bundled external.
          let resolvedPath = null
          if (externalPath.startsWith('@')) {
            // Scoped package like @npmcli/arborist.
            const [scope, name] = externalPath.split('/')
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
            // Regular package.
            const packageName = externalPath.split('/')[0]
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
        // Prevent bundling @npmcli/arborist from workspace node_modules.
        // This includes the main package and all subpaths like /lib/edge.js.
        build.onResolve({ filter: /@npmcli\/arborist/ }, args => {
          // Only redirect if it's not already coming from socket-lib's external bundle.
          if (args.importer.includes('/socket-lib/dist/')) {
            return null
          }
          return { path: args.path, external: true }
        })

        // Mark node-gyp as external (used by arborist but optionally resolved).
        build.onResolve({ filter: /node-gyp/ }, args => {
          return { path: args.path, external: true }
        })
      },
    },
  ],
}

export default createBuildRunner(config, 'CLI bundle', import.meta)
