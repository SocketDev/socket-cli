/**
 * Rollup configuration for building Socket CLI as a SINGLE bundled file.
 * This is useful for SEA/Yao packaging where everything needs to be in one file.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const srcDir = path.join(rootDir, 'src')
const distDir = path.join(rootDir, 'dist-single')

export default {
  input: path.join(srcDir, 'cli.mts'),
  output: {
    file: path.join(distDir, 'socket-cli-bundle.js'),
    format: 'cjs',
    // Bundle everything into one file
    inlineDynamicImports: true,
    interop: 'auto',
    // Include a banner for executable
    banner: '#!/usr/bin/env node\n"use strict";',
  },
  external: [
    // Only keep Node.js built-ins external
    // Everything else gets bundled
    /^node:/,
    'fs',
    'path',
    'child_process',
    'crypto',
    'http',
    'https',
    'os',
    'util',
    'stream',
    'buffer',
    'events',
    'net',
    'tls',
    'url',
    'zlib',
    'readline',
    'tty',
    'process',
    'module',
    'vm',
    'worker_threads',
  ],
  plugins: [
    // Replace environment variables
    replacePlugin({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.INLINED_SOCKET_CLI_SINGLE_FILE': JSON.stringify('1'),
      },
    }),

    // Resolve node modules
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node'],
      // Bundle all dependencies
      resolveOnly: [/.*/],
    }),

    // Handle JSON imports
    jsonPlugin(),

    // Transform TypeScript and modern JS
    babelPlugin({
      babelHelpers: 'bundled', // Bundle helpers for single file
      babelrc: false,
      configFile: path.join(__dirname, 'babel.config.js'),
      extensions: ['.mts', '.ts', '.mjs', '.js'],
      exclude: 'node_modules/**',
    }),

    // Convert CommonJS modules
    commonjsPlugin({
      ignoreDynamicRequires: false,
      // Try to handle dynamic requires
      dynamicRequireTargets: ['src/**/*.js', 'src/**/*.mjs', 'src/**/*.mts'],
    }),

    // Custom plugin to inline external packages
    {
      name: 'inline-externals',
      resolveId(source) {
        // Force bundling of @socketsecurity/registry and other packages
        if (
          source.startsWith('@socketsecurity/') ||
          source.startsWith('blessed') ||
          source.startsWith('blessed-contrib')
        ) {
          return null // Let other plugins handle it (will be bundled)
        }
      },
    },
  ],

  // Suppress warnings about large chunks since we want one file
  onwarn(warning, warn) {
    if (
      warning.code === 'EVAL' ||
      warning.code === 'CIRCULAR_DEPENDENCY' ||
      warning.code === 'THIS_IS_UNDEFINED'
    ) {
      return // Suppress these warnings
    }
    warn(warning)
  },
}
