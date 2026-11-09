/** Rollup the embedded root Socket app launcher for the Node 27 SEA VFS. */
import path from 'node:path'
import url from 'node:url'

import { babel as babelPlugin } from '@rollup/plugin-babel'
import commonjsPlugin from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

const root = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
)
export default {
  input: process.env.SEA_BOOTSTRAP || path.join(root, 'src/sea/bootstrap.mts'),
  output: {
    file: process.env.SEA_OUTPUT || path.join(root, 'dist/sea/bootstrap.cjs'),
    format: 'cjs',
    interop: 'auto',
  },
  external: [/^node:/],
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    babelPlugin({
      babelHelpers: 'runtime',
      babelrc: false,
      configFile: path.join(root, '.config/babel.config.js'),
      extensions: ['.mjs', '.js', '.ts', '.mts'],
    }),
    commonjsPlugin(),
  ],
}
