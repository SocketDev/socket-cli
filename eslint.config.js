'use strict'

const path = require('node:path')

const {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile
} = require('@eslint/compat')
const js = require('@eslint/js')
const tsParser = require('@typescript-eslint/parser')
const { createOxcImportResolver } = require('eslint-import-resolver-oxc')
const importXPlugin = require('eslint-plugin-import-x')
const nodePlugin = require('eslint-plugin-n')
const sortDestructureKeysPlugin = require('eslint-plugin-sort-destructure-keys')
const unicornPlugin = require('eslint-plugin-unicorn')
const globals = require('globals')
const tsEslint = require('typescript-eslint')

const constants = require('@socketsecurity/registry/lib/constants')
const { BIOME_JSON, GIT_IGNORE, LATEST, TSCONFIG_JSON } = constants

const { flatConfigs: origImportXFlatConfigs } = importXPlugin

const rootPath = __dirname
const rootTsConfigPath = path.join(rootPath, TSCONFIG_JSON)

const biomeConfigPath = path.join(rootPath, BIOME_JSON)
const gitignorePath = path.join(rootPath, GIT_IGNORE)

const biomeConfig = require(biomeConfigPath)

const sharedPlugins = {
  'sort-destructure-keys': sortDestructureKeysPlugin,
  unicorn: unicornPlugin
}

const sharedRules = {
  'no-await-in-loop': 'error',
  'no-control-regex': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-new': 'error',
  'no-proto': 'error',
  'no-undef': 'error',
  'no-var': 'error',
  'no-warning-comments': ['warn', { terms: ['fixme'] }],
  'prefer-const': 'error',
  'sort-destructure-keys/sort-destructure-keys': 'error',
  'sort-imports': ['error', { ignoreDeclarationSort: true }],
  'unicorn/consistent-function-scoping': 'error'
}

const sharedRulesForImportX = {
  ...origImportXFlatConfigs.recommended.rules,
  'import-x/extensions': [
    'error',
    'never',
    {
      cjs: 'ignorePackages',
      js: 'ignorePackages',
      json: 'always',
      mjs: 'ignorePackages'
    }
  ],
  'import-x/order': [
    'warn',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        ['parent', 'sibling', 'index'],
        'type'
      ],
      pathGroups: [
        {
          pattern: '@socket{registry,security}/**',
          group: 'internal'
        }
      ],
      pathGroupsExcludedImportTypes: ['type'],
      'newlines-between': 'always',
      alphabetize: {
        order: 'asc'
      }
    }
  ]
}

function getImportXFlatConfigs(isEsm) {
  return {
    recommended: {
      ...origImportXFlatConfigs.recommended,
      languageOptions: {
        ...origImportXFlatConfigs.recommended.languageOptions,
        ecmaVersion: LATEST,
        sourceType: isEsm ? 'module' : 'script'
      },
      rules: {
        ...sharedRulesForImportX,
        'import-x/no-named-as-default-member': 'off'
      }
    },
    typescript: {
      ...origImportXFlatConfigs.typescript,
      plugins: origImportXFlatConfigs.recommended.plugins,
      settings: {
        ...origImportXFlatConfigs.typescript.settings,
        'import-x/resolver-next': [
          createOxcImportResolver({
            tsConfig: {
              configFile: rootTsConfigPath,
              references: 'auto'
            }
          })
        ]
      },
      rules: {
        ...sharedRulesForImportX,
        // TypeScript compilation already ensures that named imports exist in
        // the referenced module.
        'import-x/named': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/no-unresolved': 'off'
      }
    }
  }
}

const importFlatConfigsForScript = getImportXFlatConfigs(false)
const importFlatConfigsForModule = getImportXFlatConfigs(true)

module.exports = [
  includeIgnoreFile(gitignorePath),
  {
    name: 'Imported biome.json ignore patterns',
    ignores: biomeConfig.files.ignore.map(convertIgnorePatternToMinimatch)
  },
  {
    files: ['**/*.ts'],
    ...importFlatConfigsForModule.typescript,
    languageOptions: {
      ...importFlatConfigsForModule.typescript.languageOptions,
      globals: {
        ...importFlatConfigsForModule.typescript.languageOptions?.globals,
        BufferConstructor: 'readonly',
        BufferEncoding: 'readonly',
        NodeJS: 'readonly',
        ...Object.fromEntries(
          Object.entries(globals.node).map(([k]) => [k, 'readonly'])
        )
      },
      parser: tsParser,
      parserOptions: {
        ...importFlatConfigsForModule.typescript.languageOptions?.parserOptions,
        projectService: {
          ...importFlatConfigsForModule.typescript.languageOptions
            ?.parserOptions?.projectService,
          allowDefaultProject: [
            'test/*.ts',
            // src/utils/*
            'src/*/*.test.ts',
            // src/commands/xyz/*
            'src/*/*/*.test.ts'
          ],
          defaultProject: 'tsconfig.json',
          tsconfigRootDir: rootPath,
          // Need this to glob the test files in /src. Otherwise it won't work.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 1_000_000
        }
      }
    },
    linterOptions: {
      ...importFlatConfigsForModule.typescript.linterOptions,
      reportUnusedDisableDirectives: 'off'
    },
    plugins: {
      ...importFlatConfigsForModule.typescript.plugins,
      ...sharedPlugins,
      '@typescript-eslint': tsEslint.plugin
    },
    rules: {
      ...importFlatConfigsForModule.typescript.rules,
      ...sharedRules,
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as' }
      ],
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-this-alias': [
        'error',
        { allowDestructuring: true }
      ],
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
    files: ['**/*.{c,}js'],
    ...js.configs.recommended,
    ...importFlatConfigsForScript.recommended,
    ...nodePlugin.configs['flat/recommended-script'],
    plugins: {
      ...js.configs.recommended.plugins,
      ...importFlatConfigsForScript.recommended.plugins,
      ...nodePlugin.configs['flat/recommended-script'].plugins,
      ...sharedPlugins
    },
    rules: {
      ...js.configs.recommended.rules,
      ...importFlatConfigsForScript.recommended.rules,
      ...nodePlugin.configs['flat/recommended-script'].rules,
      ...sharedRules,
      'n/exports-style': ['error', 'module.exports'],
      'n/no-missing-require': ['off'],
      // The n/no-unpublished-bin rule does does not support non-trivial glob
      // patterns used in package.json "files" fields. In those cases we simplify
      // the glob patterns used.
      'n/no-unpublished-bin': 'error',
      'n/no-unsupported-features/es-builtins': 'error',
      'n/no-unsupported-features/es-syntax': 'error',
      'n/no-unsupported-features/node-builtins': [
        'error',
        {
          ignores: ['test', 'test.describe'],
          // Lazily access constants.maintainedNodeVersions.
          version: constants.maintainedNodeVersions.last
        }
      ],
      'n/prefer-node-protocol': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_|^this$', ignoreRestSiblings: true }
      ]
    }
  },
  {
    files: ['**/*.mjs'],
    ...importFlatConfigsForModule.recommended,
    plugins: {
      ...importFlatConfigsForModule.recommended.plugins,
      ...sharedPlugins
    },
    rules: {
      ...importFlatConfigsForModule.recommended.rules,
      ...sharedRules
    }
  }
]
