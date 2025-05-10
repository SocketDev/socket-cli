'use strict'

const path = require('node:path')

const rootPath = path.join(__dirname, '..')
const scriptsPath = path.join(rootPath, 'scripts')
const babelPluginsPath = path.join(scriptsPath, 'babel')

module.exports = {
  presets: ['@babel/preset-typescript'],
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
        version: '^7.27.1'
      }
    ],
    path.join(babelPluginsPath, 'transform-set-proto-plugin.js'),
    path.join(babelPluginsPath, 'transform-url-parse-plugin.js')
  ]
}
