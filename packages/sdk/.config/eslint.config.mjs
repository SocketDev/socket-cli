import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile,
} from '@eslint/compat'
import jsPlugin from '@eslint/js'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import { flatConfigs as origImportXFlatConfigs } from 'eslint-plugin-import-x'
import jsdocPlugin from 'eslint-plugin-jsdoc'
import nodePlugin from 'eslint-plugin-n'
import sortDestructureKeysPlugin from 'eslint-plugin-sort-destructure-keys'
import unicornPlugin from 'eslint-plugin-unicorn'
import globals from 'globals'
import tsEslint from 'typescript-eslint'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Get maintained Node versions - inline to avoid registry dependency
const getMaintainedNodeVersions = () => ['18', '20', '22', '24']

const rootPath = path.dirname(__dirname)

// Use local config if local Socket packages are detected
const localPackageAliases = getLocalPackageAliases(rootPath)
const hasLocalPackages = Object.keys(localPackageAliases).length > 0
const rootTsConfigPath = path.join(
  __dirname,
  hasLocalPackages ? 'tsconfig.check.local.json' : 'tsconfig.check.json',
)

const nodeGlobalsConfig = Object.fromEntries(
  Object.entries(globals.node).map(([k]) => [k, 'readonly']),
)

const biomeConfigPath = path.join(rootPath, 'biome.json')
const biomeConfig = require(biomeConfigPath)
const biomeIgnores = {
  name: 'Imported biome.json ignore patterns',
  ignores: biomeConfig.files.includes
    .filter(p => p.startsWith('!'))
    .map(p => convertIgnorePatternToMinimatch(p.slice(1))),
}

const gitignorePath = path.join(rootPath, '.gitignore')
const gitIgnores = {
  ...includeIgnoreFile(gitignorePath),
  name: 'Imported .gitignore ignore patterns',
}

const sharedPlugins = {
  ...nodePlugin.configs['flat/recommended-script'].plugins,
  'sort-destructure-keys': sortDestructureKeysPlugin,
  unicorn: unicornPlugin,
}

const sharedRules = {
  'n/exports-style': ['error', 'module.exports'],
  'n/no-missing-require': ['off'],
  'n/no-process-exit': 'error',
  // The n/no-unpublished-bin rule does does not support non-trivial glob
  // patterns used in package.json "files" fields. In those cases we simplify
  // the glob patterns used.
  'n/no-unpublished-bin': 'error',
  'n/no-unsupported-features/es-builtins': 'error',
  'n/no-unsupported-features/es-syntax': [
    'error',
    {
      ignores: ['promise-withresolvers'],
      // Lazily access constants.maintainedNodeVersions.
      version: getMaintainedNodeVersions().current,
    },
  ],
  'n/no-unsupported-features/node-builtins': [
    'error',
    {
      ignores: [
        'test',
        'test.describe',
        'ReadableStream',
        'events.getMaxListeners',
      ],
      // Lazily access constants.maintainedNodeVersions.
      version: getMaintainedNodeVersions().current,
    },
  ],
  'n/prefer-node-protocol': 'error',
  'unicorn/consistent-function-scoping': 'error',
  curly: 'error',
  'line-comment-position': ['error', { position: 'above' }],
  'no-await-in-loop': 'error',
  'no-control-regex': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-new': 'error',
  'no-proto': 'error',
  'no-undef': 'error',
  'no-unexpected-multiline': 'off',
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_|^this$',
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_',
    },
  ],
  'no-var': 'error',
  'no-warning-comments': ['warn', { terms: ['fixme'] }],
  'prefer-const': 'error',
  'sort-destructure-keys/sort-destructure-keys': 'error',
  'sort-imports': 'off',
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
      mjs: 'ignorePackages',
    },
  ],
  'import-x/no-unresolved': [
    'error',
    {
      // Ignore @socketsecurity/registry and @socketsecurity/lib subpaths - resolved by runtime loader
      ignore: ['^@socketsecurity/registry/', '^@socketsecurity/lib/'],
    },
  ],
  'import-x/order': [
    'warn',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        ['parent', 'sibling', 'index'],
        'type',
      ],
      pathGroups: [
        {
          pattern: '@socket{registry,security}/**',
          group: 'internal',
        },
      ],
      pathGroupsExcludedImportTypes: ['type'],
      'newlines-between': 'always',
      alphabetize: {
        order: 'asc',
      },
    },
  ],
}

function getImportXFlatConfigs(isEsm) {
  return {
    recommended: {
      ...origImportXFlatConfigs.recommended,
      languageOptions: {
        ...origImportXFlatConfigs.recommended.languageOptions,
        ecmaVersion: 'latest',
        sourceType: isEsm ? 'module' : 'script',
      },
      rules: {
        ...sharedRulesForImportX,
        'import-x/no-named-as-default-member': 'off',
      },
    },
    typescript: {
      ...origImportXFlatConfigs.typescript,
      plugins: origImportXFlatConfigs.recommended.plugins,
      settings: {
        ...origImportXFlatConfigs.typescript.settings,
        'import-x/resolver-next': [
          createTypeScriptImportResolver({
            project: rootTsConfigPath,
          }),
        ],
      },
      rules: {
        ...sharedRulesForImportX,
        // TypeScript compilation already ensures that named imports exist in
        // the referenced module.
        'import-x/named': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/no-unresolved': 'off',
      },
    },
  }
}

const importFlatConfigsForScript = getImportXFlatConfigs(false)
const importFlatConfigsForModule = getImportXFlatConfigs(true)

export default [
  biomeIgnores,
  gitIgnores,
  {
    ignores: [
      // Dot folders.
      '.*/**',
      // Nested directories.
      '**/coverage/**',
      '**/dist/**',
      '**/external/**',
      '**/node_modules/**',
      // Generated TypeScript files.
      '**/*.d.ts',
      '**/*.d.ts.map',
      '**/*.tsbuildinfo',
    ],
  },
  {
    files: ['**/*.{cts,mts,ts}'],
    ...jsPlugin.configs.recommended,
    ...importFlatConfigsForModule.typescript,
    languageOptions: {
      ...jsPlugin.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.typescript.languageOptions,
      globals: {
        ...jsPlugin.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.typescript.languageOptions?.globals,
        ...nodeGlobalsConfig,
        BufferConstructor: 'readonly',
        BufferEncoding: 'readonly',
        NodeJS: 'readonly',
      },
      parser: tsEslint.parser,
      parserOptions: {
        ...jsPlugin.configs.recommended.languageOptions?.parserOptions,
        ...importFlatConfigsForModule.typescript.languageOptions?.parserOptions,
        projectService: {
          ...importFlatConfigsForModule.typescript.languageOptions
            ?.parserOptions?.projectService,
          ...jsdocPlugin.configs['flat/recommended'].languageOptions
            ?.parserOptions?.projectService,
          allowDefaultProject: [
            // Allow configs.
            '.config/*.config.mts',
            '.config/*.config.isolated.mts',
            '*.config.mts',
            'test/*.mts',
            'test/utils/*.mts',
            'src/*.mts',
          ],
          defaultProject: rootTsConfigPath,
          tsconfigRootDir: rootPath,
          // Need this to glob test files in src.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
        },
      },
    },
    linterOptions: {
      ...jsPlugin.configs.recommended.linterOptions,
      ...importFlatConfigsForModule.typescript.linterOptions,
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      ...jsPlugin.configs.recommended.plugins,
      ...importFlatConfigsForModule.typescript.plugins,
      ...sharedPlugins,
      '@typescript-eslint': tsEslint.plugin,
    },
    rules: {
      ...jsPlugin.configs.recommended.rules,
      ...importFlatConfigsForModule.typescript.rules,
      ...sharedRules,
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as' },
      ],
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-this-alias': [
        'error',
        { allowDestructuring: true },
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
      'dot-notation': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.{cjs,js}'],
    ...jsPlugin.configs.recommended,
    ...importFlatConfigsForScript.recommended,
    ...nodePlugin.configs['flat/recommended-script'],
    languageOptions: {
      ...jsPlugin.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.recommended.languageOptions,
      ...nodePlugin.configs['flat/recommended-script'].languageOptions,
      globals: {
        ...jsPlugin.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.recommended.languageOptions?.globals,
        ...nodePlugin.configs['flat/recommended-script'].languageOptions
          ?.globals,
        ...nodeGlobalsConfig,
      },
    },
    plugins: {
      ...jsPlugin.configs.recommended.plugins,
      ...importFlatConfigsForScript.recommended.plugins,
      ...sharedPlugins,
    },
    rules: {
      ...jsPlugin.configs.recommended.rules,
      ...importFlatConfigsForScript.recommended.rules,
      ...nodePlugin.configs['flat/recommended-script'].rules,
      ...sharedRules,
    },
  },
  {
    files: ['**/*.mjs'],
    ...jsPlugin.configs.recommended,
    ...importFlatConfigsForModule.recommended,
    languageOptions: {
      ...jsPlugin.configs.recommended.languageOptions,
      ...importFlatConfigsForModule.recommended.languageOptions,
      globals: {
        ...jsPlugin.configs.recommended.languageOptions?.globals,
        ...importFlatConfigsForModule.recommended.languageOptions?.globals,
        ...nodeGlobalsConfig,
      },
      sourceType: 'module',
    },
    plugins: {
      ...jsPlugin.configs.recommended.plugins,
      ...importFlatConfigsForModule.recommended.plugins,
      ...sharedPlugins,
    },
    rules: {
      ...jsPlugin.configs.recommended.rules,
      ...importFlatConfigsForModule.recommended.rules,
      ...sharedRules,
    },
  },
  {
    // Relax rules for script files
    files: ['scripts/**/*.{cjs,mjs}'],
    rules: {
      'n/no-process-exit': 'off',
      'no-await-in-loop': 'off',
    },
  },
  {
    files: ['src/**/*.{cjs,js}'],
    ...jsdocPlugin.configs['flat/recommended'],
  },
]
