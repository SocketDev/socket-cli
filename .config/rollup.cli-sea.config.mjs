/**
 * Rollup configuration for building SEA bootstrap thin wrapper.
 * Compiles TypeScript bootstrap to CommonJS for Node.js SEA compatibility.
 */

import path from 'node:path'
import url from 'node:url'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

export default {
  input:
    process.env.SEA_BOOTSTRAP || path.join(rootDir, 'src/stub/bootstrap.mts'),
  output: {
    file:
      process.env.SEA_OUTPUT || path.join(rootDir, 'dist/sea/bootstrap.cjs'),
    format: 'cjs',
    interop: 'auto',
  },
  external: [
    // Only externalize Node.js built-ins for the thin wrapper.
    /^node:/,
  ],
  plugins: [
    nodeResolve({
      alias: getLocalPackageAliases(rootDir),
      preferBuiltins: true,
      exportConditions: ['node'],
    }),
    babelPlugin({
      babelHelpers: 'runtime',
      babelrc: false,
      configFile: path.join(__dirname, 'babel.config.js'),
      extensions: ['.mjs', '.js', '.ts', '.mts'],
    }),
    commonjsPlugin(),
  ],
}
