'use strict'

const path = require('node:path')

const { includeIgnoreFile } = require('@eslint/compat')

const { ignores } = includeIgnoreFile(path.join(__dirname, '.gitignore'))

module.exports = {
  ignorePatterns: ignores,
  extends: [
    '@socketsecurity',
    'plugin:import/typescript',
    'plugin:depend/recommended',
    'prettier'
  ],
  parserOptions: {
    project: ['./tsconfig.json'],
    EXPERIMENTAL_useProjectService: {
      maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 1e10
    }
  },
  rules: {
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/no-floating-promises': [
      'error',
      {
        ignoreIIFE: true,
        ignoreVoid: true
      }
    ],
    // Returning unawaited promises in a try/catch/finally is dangerous
    // (the `catch` won't catch if the promise is rejected, and the `finally`
    // won't wait for the promise to resolve). Returning unawaited promises
    // elsewhere is probably fine, but this lint rule doesn't have a way
    // to only apply to try/catch/finally (the 'in-try-catch' option *enforces*
    // not awaiting promises *outside* of try/catch/finally, which is not what
    // we want), and it's nice to await before returning anyways, since you get
    // a slightly more comprehensive stack trace upon promise rejection.
    '@typescript-eslint/return-await': ['error', 'always'],
    'depend/ban-dependencies': [
      'warn',
      {
        allowed: ['globby']
      }
    ],
    'no-warning-comments': ['warn', { terms: ['fixme'] }]
  }
}
