'use strict'

const path = require('node:path')

const eslintPluginUnicorn = require('eslint-plugin-unicorn')
const { includeIgnoreFile } = require('@eslint/compat')
const js = require('@eslint/js')
const tsEslint = require('typescript-eslint')
const tsParser = require('@typescript-eslint/parser')

const gitignorePath = path.resolve(__dirname, '.gitignore')
const prettierignorePath = path.resolve(__dirname, '.prettierignore')

const sharedPlugins = {
  __proto__: null,
  unicorn: eslintPluginUnicorn
}

const sharedRules = {
  __proto__: null,
  ...js.configs.recommended.rules,
  'no-await-in-loop': ['error'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-control-regex': ['error'],
  'no-new': ['error'],
  'no-undef': 'off',
  'no-unused-vars': 'off',
  'no-warning-comments': ['warn', { terms: ['fixme'] }],
  'unicorn/consistent-function-scoping': 'off'
}

module.exports = [
  includeIgnoreFile(gitignorePath),
  includeIgnoreFile(prettierignorePath),
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['test/*.ts'],
          defaultProject: 'tsconfig.json',
          tsconfigRootDir: __dirname
        }
      }
    },
    plugins: {
      __proto__: null,
      ...sharedPlugins,
      '@typescript-eslint': tsEslint.plugin
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off'
    },
    rules: {
      __proto__: null,
      ...sharedRules,
      '@typescript-eslint/no-floating-promises': ['error'],
      '@typescript-eslint/no-misused-promises': ['error'],
      // Define @typescript-eslint/no-this-alias because oxlint defines
      // "no-this-alias": ["deny"] and trying to eslint-disable it will
      // cause an eslint "Definition not found" error otherwise.
      '@typescript-eslint/no-this-alias': ['error'],
      // Returning unawaited promises in a try/catch/finally is dangerous
      // (the `catch` won't catch if the promise is rejected, and the `finally`
      // won't wait for the promise to resolve). Returning unawaited promises
      // elsewhere is probably fine, but this lint rule doesn't have a way
      // to only apply to try/catch/finally (the 'in-try-catch' option *enforces*
      // not awaiting promises *outside* of try/catch/finally, which is not what
      // we want), and it's nice to await before returning anyways, since you get
      // a slightly more comprehensive stack trace upon promise rejection.
      '@typescript-eslint/return-await': ['error', 'always']
    }
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off'
    }
  },
  {
    files: ['scripts/**/*.js', 'test/**/*.cjs'],
    plugins: {
      __proto__: null,
      ...sharedPlugins
    },
    rules: {
      __proto__: null,
      ...sharedRules
    }
  }
]
