'use strict'

const path = require('node:path')

const rootPath = path.join(__dirname, '..')
const scriptsPath = path.join(rootPath, 'scripts')
const babelPluginsPath = path.join(scriptsPath, 'babel')

module.exports = {
  presets: [
    '@babel/preset-typescript',
    [
      '@babel/preset-react',
      {
        runtime: 'automatic',
      },
    ],
  ],
  plugins: [
    '@babel/plugin-proposal-export-default-from',
    '@babel/plugin-transform-export-namespace-from',
    [
      '@babel/plugin-transform-runtime',
      {
        absoluteRuntime: false,
        corejs: false,
        helpers: true,
        regenerator: false,
        version: '^7.27.1',
      },
    ],
    // Run strict-mode transformations first to fix loose-mode code
    path.join(babelPluginsPath, 'babel-plugin-strict-mode.mjs'),
    path.join(babelPluginsPath, 'babel-plugin-inline-require-calls.js'),
    path.join(babelPluginsPath, 'transform-set-proto-plugin.mjs'),
    path.join(babelPluginsPath, 'transform-url-parse-plugin.mjs'),
    // Run ICU removal last to transform Intl/locale APIs
    path.join(babelPluginsPath, 'babel-plugin-english-only-icu.mjs'),
  ],
}
