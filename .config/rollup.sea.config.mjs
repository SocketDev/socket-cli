/**
 * Rollup configuration for building SEA bootstrap thin wrapper.
 * Compiles TypeScript bootstrap to CommonJS for Node.js SEA compatibility.
 */

import path from 'node:path'
import url from 'node:url'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replacePlugin from '@rollup/plugin-replace'
import maintainedNodeVersions from '@socketsecurity/registry/lib/constants/maintained-node-versions'
import UnpluginOxc from 'unplugin-oxc/rollup'
import semver from 'semver'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production' || process.env.MINIFY === '1'

// Get the major version of the current maintained Node.js version (22.x.x -> 22)
const MIN_NODE_VERSION = semver.major(maintainedNodeVersions[2])

export default {
  input:
    process.env.SEA_BOOTSTRAP || path.join(rootDir, 'src/sea/bootstrap.mts'),
  output: {
    file:
      process.env.SEA_OUTPUT || path.join(rootDir, 'dist/sea/bootstrap.cjs'),
    format: 'cjs',
    interop: 'auto',
  },
  external: [
    // Only externalize Node.js built-ins for the thin wrapper.
    // nanotar package will be inlined (not external).
    /^node:/,
  ],
  plugins: [
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node'],
    }),
    // Inline process.env.MIN_NODE_VERSION at build time from maintainedNodeVersions
    replacePlugin({
      preventAssignment: true,
      values: {
        'process.env.MIN_NODE_VERSION': JSON.stringify(MIN_NODE_VERSION),
        "process.env['MIN_NODE_VERSION']": JSON.stringify(MIN_NODE_VERSION),
      },
    }),
    babelPlugin({
      babelHelpers: 'runtime',
      babelrc: false,
      configFile: path.join(__dirname, 'babel.config.js'),
      extensions: ['.mjs', '.js', '.ts', '.mts'],
    }),
    commonjsPlugin(),
    // Minify in production builds using oxc (faster than terser)
    isProduction &&
      UnpluginOxc({
        minify: {
          compress: {},
          mangle: true,
        },
      }),
  ].filter(Boolean),
}
