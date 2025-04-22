'use strict'

const path = require('node:path')

const {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile
} = require('@eslint/compat')
const js = require('@eslint/js')
const tsParser = require('@typescript-eslint/parser')
const {
  createTypeScriptImportResolver
} = require('eslint-import-resolver-typescript')
const importXPlugin = require('eslint-plugin-import-x')
const nodePlugin = require('eslint-plugin-n')
const sortDestructureKeysPlugin = require('eslint-plugin-sort-destructure-keys')
const unicornPlugin = require('eslint-plugin-unicorn')
const globals = require('globals')
const tsEslint = require('typescript-eslint')

const constants = require('@socketsecurity/registry/lib/constants')
const { BIOME_JSON, GITIGNORE, LATEST, TSCONFIG_JSON } = constants

const { flatConfigs: origImportXFlatConfigs } = importXPlugin

const rootPath = __dirname
const rootTsConfigPath = path.join(rootPath, TSCONFIG_JSON)

const biomeConfigPath = path.join(rootPath, BIOME_JSON)
const gitignorePath = path.join(rootPath, GITIGNORE)

const biomeConfig = require(biomeConfigPath)
const nodeGlobalsConfig = Object.fromEntries(
  Object.entries(globals.node).map(([k]) => [k, 'readonly'])
)

const sharedPlugins = {
  'sort-destructure-keys': sortDestructureKeysPlugin,
  unicorn: unicornPlugin
}

const sharedRules = {
  'unicorn/consistent-function-scoping': 'error',
  curly: 'error',
  'no-await-in-loop': 'error',
  'no-control-regex': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-new': 'error',
  'no-proto': 'error',
  'no-undef': 'error',
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_|^this$',
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_'
    }
  ],
  'no-var': 'error',
  'no-warning-comments': ['warn', { terms: ['fixme'] }],
  'prefer-const': 'error',
  'sort-destructure-keys/sort-destructure-keys': 'error',
  'sort-imports': ['error', { ignoreDeclarationSort: true }]
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

const sharedRulesForNode = {
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
      ignores: ['fs.promises.cp', 'readline/promises', 'test', 'test.describe'],
      // Lazily access constants.maintainedNodeVersions.
      version: constants.maintainedNodeVersions.current
    }
  ],
  'n/prefer-node-protocol': 'error'
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
          createTypeScriptImportResolver({
            project: rootTsConfigPath
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

const biomeIgnores = {
  name: 'Imported biome.json ignore patterns',
  ignores: biomeConfig.files.ignore.map(convertIgnorePatternToMinimatch)
}
const gitIgnores = includeIgnoreFile(gitignorePath)

if (process.env.LINT_DIST) {
  const isNotDistGlobPattern = p => !/(?:^|[\\/])dist/.test(p)
  biomeIgnores.ignores = biomeIgnores.ignores?.filter(isNotDistGlobPattern)
  gitIgnores.ignores = gitIgnores.ignores?.filter(isNotDistGlobPattern)
}
if (process.env.LINT_EXTERNAL) {
  const isNotExternalGlobPattern = p => !/(?:^|[\\/])external/.test(p)
  biomeIgnores.ignores = biomeIgnores.ignores?.filter(isNotExternalGlobPattern)
  gitIgnores.ignores = gitIgnores.ignores?.filter(isNotExternalGlobPattern)
}

module.exports = [
  gitIgnores,
  biomeIgnores,
  {
    files: ['**/*.{cts,mts,ts}'],
    ...js.configs.recommended,
    ...importFlatConfigsForModule.typescript,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.typescript.languageOptions,
      globals: {
        ...js.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.typescript.languageOptions?.globals,
        ...nodeGlobalsConfig,
        BufferConstructor: 'readonly',
        BufferEncoding: 'readonly',
        NodeJS: 'readonly'
      },
      parser: tsParser,
      parserOptions: {
        ...js.configs.recommended.languageOptions?.parserOptions,
        ...importFlatConfigsForModule.typescript.languageOptions?.parserOptions,
        projectService: {
          ...importFlatConfigsForModule.typescript.languageOptions
            ?.parserOptions?.projectService,
          allowDefaultProject: [
            // Allow paths like src/utils/*.test.ts.
            'src/*/*.test.ts',
            // Allow paths like src/commands/optimize/*.test.ts.
            'src/*/*/*.test.ts',
            'test/*.ts',
            'vitest.config.mts'
          ],
          defaultProject: 'tsconfig.json',
          tsconfigRootDir: rootPath,
          // Need this to glob the test files in /src. Otherwise it won't work.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 1_000_000
        }
      }
    },
    linterOptions: {
      ...js.configs.recommended.linterOptions,
      ...importFlatConfigsForModule.typescript.linterOptions,
      reportUnusedDisableDirectives: 'off'
    },
    plugins: {
      ...js.configs.recommended.plugins,
      ...importFlatConfigsForModule.typescript.plugins,
      ...nodePlugin.configs['flat/recommended-module'].plugins,
      ...sharedPlugins,
      '@typescript-eslint': tsEslint.plugin
    },
    rules: {
      ...js.configs.recommended.rules,
      ...importFlatConfigsForModule.typescript.rules,
      ...nodePlugin.configs['flat/recommended-module'].rules,
      ...sharedRulesForNode,
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
      '@typescript-eslint/return-await': ['error', 'always'],
      // Disable the following rules because they don't play well with TypeScript.
      'n/hashbang': 'off',
      'n/no-extraneous-import': 'off',
      'n/no-missing-import': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['**/*.{cjs,js}'],
    ...js.configs.recommended,
    ...importFlatConfigsForScript.recommended,
    ...nodePlugin.configs['flat/recommended-script'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.recommended.languageOptions,
      ...nodePlugin.configs['flat/recommended-script'].languageOptions,
      globals: {
        ...js.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.recommended.languageOptions?.globals,
        ...nodePlugin.configs['flat/recommended-script'].languageOptions
          ?.globals,
        ...nodeGlobalsConfig
      }
    },
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
      ...sharedRulesForNode,
      ...sharedRules
    }
  },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    ...importFlatConfigsForModule.recommended,
    ...nodePlugin.configs['flat/recommended-module'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.recommended.languageOptions,
      ...nodePlugin.configs['flat/recommended-module'].languageOptions,
      globals: {
        ...js.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.recommended.languageOptions?.globals,
        ...nodePlugin.configs['flat/recommended-module'].languageOptions
          ?.globals,
        ...nodeGlobalsConfig
      }
    },
    plugins: {
      ...js.configs.recommended.plugins,
      ...importFlatConfigsForModule.recommended.plugins,
      ...nodePlugin.configs['flat/recommended-module'].plugins,
      ...sharedPlugins
    },
    rules: {
      ...js.configs.recommended.rules,
      ...importFlatConfigsForModule.recommended.rules,
      ...nodePlugin.configs['flat/recommended-module'].rules,
      ...sharedRulesForNode,
      ...sharedRules
    }
  }
]
