'use strict'

const path = require('node:path')

const { includeIgnoreFile } = require('@eslint/compat')
const js = require('@eslint/js')
const nodePlugin = require('eslint-plugin-n')
const sortDestructureKeysPlugin = require('eslint-plugin-sort-destructure-keys')
const unicornPlugin = require('eslint-plugin-unicorn')
const tsEslint = require('typescript-eslint')
const tsParser = require('@typescript-eslint/parser')

const gitignorePath = path.resolve(__dirname, '.gitignore')
const prettierignorePath = path.resolve(__dirname, '.prettierignore')

const sharedPlugins = {
  'sort-destructure-keys': sortDestructureKeysPlugin,
  unicorn: unicornPlugin
}

const sharedRules = {
  'no-await-in-loop': ['error'],
  'no-control-regex': ['error'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-new': ['error'],
  'no-proto': ['error'],
  'no-warning-comments': ['warn', { terms: ['fixme'] }],
  'sort-destructure-keys/sort-destructure-keys': ['error'],
  'sort-imports': ['error', { ignoreDeclarationSort: true }],
  'unicorn/consistent-function-scoping': ['error']
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
      ...sharedPlugins,
      '@typescript-eslint': tsEslint.plugin
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off'
    },
    rules: {
      ...sharedRules,
      // Define @typescript-eslint/no-extraneous-class because oxlint defines
      // "no-extraneous-class": ["deny"] and trying to eslint-disable it will
      // cause an eslint "Definition not found" error otherwise.
      '@typescript-eslint/no-extraneous-class': ['error'],
      '@typescript-eslint/no-floating-promises': ['error'],
      // Define @typescript-eslint/no-misused-new because oxlint defines
      // "no-misused-new": ["deny"] and trying to eslint-disable it will
      // cause an eslint "Definition not found" error otherwise.
      '@typescript-eslint/no-misused-new': ['error'],
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
    ...nodePlugin.configs['flat/recommended-script']
  },
  {
    files: ['scripts/**/*.js', 'test/**/*.cjs'],
    plugins: {
      ...sharedPlugins
    },
    rules: {
      ...js.configs.recommended.rules,
      ...sharedRules,
      'n/exports-style': ['error', 'module.exports'],
      // The n/no-unpublished-bin rule does does not support non-trivial glob
      // patterns used in package.json "files" fields. In those cases we simplify
      // the glob patterns used.
      'n/no-unpublished-bin': ['error'],
      'n/no-unsupported-features/es-builtins': ['error'],
      'n/no-unsupported-features/es-syntax': ['error'],
      'n/no-unsupported-features/node-builtins': ['error'],
      'n/prefer-node-protocol': ['error'],
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_|^this$', ignoreRestSiblings: true }
      ]
    }
  }
]
