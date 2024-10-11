'use strict'

const { isEsmId } = require('../scripts/utils/packages')

module.exports = {
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
        version: '^7.25.7'
      }
    ],
    [
      '@babel/plugin-transform-modules-commonjs',
      {
        allowTopLevelThis: true,
        importInterop: (specifier, requestingFilename) => {
          if (requestingFilename) {
            const specIsEsm = isEsmId(specifier, requestingFilename)
            const parentIsEsm = isEsmId(requestingFilename)
            if (specIsEsm && parentIsEsm) {
              return 'none'
            }
            if (specIsEsm) {
              return 'babel'
            }
          }
          return 'node'
        }
      }
    ]
  ]
}
