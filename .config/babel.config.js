'use strict'

const path = require('node:path')

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
        version: '^7.26.10'
      }
    ],
    path.resolve('./scripts/babel/transform-set-proto-plugin.js')
  ]
}
