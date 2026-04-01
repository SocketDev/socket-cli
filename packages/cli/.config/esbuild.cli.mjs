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
  createDefineEntries,
  envVarReplacementPlugin,
  getInlinedEnvVars,
  runBuild,
} from '../scripts/esbuild-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

const inlinedEnvVars = getInlinedEnvVars()

// Matches ./external/, ../external/, ../../external/, etc. (forward and back slashes).
const socketLibExternalPathRegExp = /^(?:\.[/\\]|(?:\.\.[/\\])+)external[/\\]/

function findSocketLibPath(importerPath) {
  const match = importerPath.match(/^(.*\/@socketsecurity\/lib)\b/)
  if (match) {
    return match[1]
  }
  const localPath = path.join(rootPath, '..', '..', '..', 'socket-lib')
  if (existsSync(localPath)) {
    return localPath
  }
  return null
}

function resolveSocketLibExternal(socketLibPath, packageName) {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/')
    const p = path.join(socketLibPath, 'dist', 'external', scope, `${name}.js`)
    return existsSync(p) ? p : null
  }
  const p = path.join(
    socketLibPath,
    'dist',
    'external',
    `${packageName.split('/')[0]}.js`,
  )
  return existsSync(p) ? p : null
}


const config = {
  entryPoints: [path.join(rootPath, 'src/cli-dispatch.mts')],
  bundle: true,
  outfile: path.join(rootPath, 'build/cli.js'),
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logOverride: {
    'commonjs-variable-in-esm': 'silent',
    'require-resolve-not-external': 'silent',
  },
  // .cs files used by node-gyp on Windows.
  loader: { '.cs': 'empty' },
  sourcemap: false,
  minify: false,
  keepNames: true,
  write: false,
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': '__importMetaUrl',
    ...createDefineEntries(inlinedEnvVars),
  },
  banner: {
    js: `#!/usr/bin/env node\n"use strict";\n${IMPORT_META_URL_BANNER.js}`,
  },

  plugins: [
    unicodeTransformPlugin(),
    // Environment variable replacement must run AFTER unicode transform.
    envVarReplacementPlugin(inlinedEnvVars),
    {
      name: 'resolve-socket-lib-internals',
      setup(build) {
        function resolveConstant(args, strip) {
          if (!args.importer.includes('/socket-lib/dist/')) {
            return null
          }
          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }
          const p = path.join(
            socketLibPath,
            'dist',
            'constants',
            `${args.path.replace(strip, '')}.js`,
          )
          return existsSync(p) ? { path: p } : null
        }

        build.onResolve({ filter: /^\.\.\/constants\// }, args =>
          resolveConstant(args, /^\.\.\/constants\//),
        )

        build.onResolve({ filter: /^\.\.\/\.\.\/constants\// }, args =>
          resolveConstant(args, /^\.\.\/\.\.\/constants\//),
        )

        build.onResolve({ filter: socketLibExternalPathRegExp }, args => {
          if (!args.importer.includes('@socketsecurity/lib/dist/')) {
            return null
          }
          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }
          const externalPath = args.path
            .replace(socketLibExternalPathRegExp, '')
            .replace(/\.js$/, '')
          const p = resolveSocketLibExternal(socketLibPath, externalPath)
          return p ? { path: p } : null
        })

        build.onResolve({ filter: /^(@[^/]+\/[^/]+|[^./][^/]*)/ }, args => {
          if (!args.importer.includes('/socket-lib/dist/')) {
            return null
          }
          const socketLibPath = findSocketLibPath(args.importer)
          if (!socketLibPath) {
            return null
          }
          const packageName = args.path.startsWith('@')
            ? args.path.split('/').slice(0, 2).join('/')
            : args.path.split('/')[0]
          const p = resolveSocketLibExternal(socketLibPath, packageName)
          return p ? { path: p } : null
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

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'CLI bundle').catch(() => { process.exitCode = 1 })
}

export default config
