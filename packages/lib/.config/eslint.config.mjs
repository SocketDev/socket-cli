import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile,
} from '@eslint/compat'
import js from '@eslint/js'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import { flatConfigs as origImportXFlatConfigs } from 'eslint-plugin-import-x'
import nodePlugin from 'eslint-plugin-n'
import sortDestructureKeysPlugin from 'eslint-plugin-sort-destructure-keys'
import unicornPlugin from 'eslint-plugin-unicorn'
import globals from 'globals'
import tsEslint from 'typescript-eslint'

// Resolve current module paths for proper configuration loading.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

const rootPath = path.dirname(__dirname)
const rootTsConfigPath = path.join(rootPath, 'tsconfig.json')

// Convert Node.js globals to readonly format for ESLint configuration.
// This ensures Node.js built-ins are recognized but not modifiable.
const nodeGlobalsConfig = Object.fromEntries(
  Object.entries(globals.node).map(([k]) => [k, 'readonly']),
)

// Import Biome config to synchronize ignore patterns between formatters.
// This reduces configuration duplication and ensures consistent file filtering.
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

// OPTIMIZATION: When LINT_EXTERNAL is set, include external dependencies in linting.
// This is disabled by default for performance since external deps are pre-validated.
// Enable only for comprehensive checks before releases.
if (process.env.LINT_EXTERNAL) {
  const isNotExternalGlobPattern = p => !/(?:^|[\\/])external/.test(p)
  if (biomeIgnores.ignores) {
    biomeIgnores.ignores = biomeIgnores.ignores.filter(isNotExternalGlobPattern)
  }
  if (gitIgnores.ignores) {
    gitIgnores.ignores = gitIgnores.ignores.filter(isNotExternalGlobPattern)
  }
}

// OPTIMIZATION: For socket-lib (single package), no dynamic ignore patterns needed.
// This is a simplified version for non-monorepo usage.
function getIgnores(_isEsm) {
  return []
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
    },
    typescript: {
      ...origImportXFlatConfigs.typescript,
      plugins: {
        ...origImportXFlatConfigs.recommended.plugins,
        ...origImportXFlatConfigs.typescript.plugins,
      },
      settings: {
        ...origImportXFlatConfigs.typescript.settings,
        'import-x/resolver-next': [
          createTypeScriptImportResolver({
            project: rootTsConfigPath,
          }),
        ],
      },
      rules: {
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
        // Disable import ordering auto-fix to prevent conflicts with Biome.
        // Biome handles import formatting and organization.
        'import-x/order': 'off',
        // TypeScript compilation already ensures that named imports exist in
        // the referenced module.
        'import-x/named': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/no-unresolved': 'off',
      },
    },
  }
}

function configs(sourceType) {
  const isEsm = sourceType === 'module'
  const ignores = getIgnores(isEsm)
  const importFlatConfigs = getImportXFlatConfigs(isEsm)
  const nodePluginConfigs =
    nodePlugin.configs[`flat/recommended-${isEsm ? 'module' : 'script'}`]
  const sharedPlugins = {
    ...nodePluginConfigs.plugins,
    'sort-destructure-keys': sortDestructureKeysPlugin,
    unicorn: unicornPlugin,
  }
  const sharedRules = {
    'line-comment-position': ['error', { position: 'above' }],
    'n/exports-style': ['error', 'module.exports'],
    // The n/no-unpublished-bin rule does does not support non-trivial glob
    // patterns used in package.json "files" fields. In those cases we simplify
    // the glob patterns used.
    'n/no-unpublished-bin': 'error',
    'no-unexpected-multiline': 'off',
    'n/no-unsupported-features/es-builtins': [
      'error',
      {
        ignores: ['Object.groupBy'],
        version: '>=22',
      },
    ],
    'n/no-unsupported-features/es-syntax': [
      'error',
      {
        ignores: ['object-map-groupby'],
        version: '>=22',
      },
    ],
    'n/no-unsupported-features/node-builtins': [
      'error',
      {
        ignores: [
          'buffer.File',
          'buffer.isAscii',
          'buffer.isUtf8',
          'buffer.resolveObjectURL',
          'events.getMaxListeners',
          'fetch',
          'fs.promises.cp',
          'module.isBuiltin',
          'process.features.require_module',
          'ReadableStream',
          'Response',
        ],
        version: '>=22',
      },
    ],
    'n/prefer-node-protocol': 'off',
    'unicorn/consistent-function-scoping': 'error',
    curly: 'error',
    'no-await-in-loop': 'error',
    // Disable no-control-regex - ANSI escape sequences intentionally use control chars.
    // Biome handles this check via lint/suspicious/noControlCharactersInRegex.
    'no-control-regex': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-new': 'error',
    'no-proto': 'error',
    'no-undef': 'error',
    'no-self-assign': ['error', { props: false }],
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_|^this$',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
      },
    ],
    'no-var': 'error',
    'no-warning-comments': 'error',
    'prefer-const': 'error',
    'sort-destructure-keys/sort-destructure-keys': 'error',
    // Disable sort-imports to prevent conflicts with Biome.
    // Biome handles import formatting and organization.
    'sort-imports': 'off',
  }

  return [
    {
      ...js.configs.recommended,
      ...importFlatConfigs.recommended,
      ...nodePluginConfigs,
      ignores,
      languageOptions: {
        ...js.configs.recommended.languageOptions,
        ...importFlatConfigs.recommended.languageOptions,
        ...nodePluginConfigs.languageOptions,
        globals: {
          ...js.configs.recommended.languageOptions?.globals,
          ...importFlatConfigs.recommended.languageOptions?.globals,
          ...nodePluginConfigs.languageOptions?.globals,
          ...nodeGlobalsConfig,
          NodeJS: false,
        },
        sourceType: isEsm ? 'module' : 'script',
      },
      plugins: {
        ...js.configs.recommended.plugins,
        ...importFlatConfigs.recommended.plugins,
        ...sharedPlugins,
      },
      rules: {
        ...js.configs.recommended.rules,
        ...importFlatConfigs.recommended.rules,
        ...nodePluginConfigs.rules,
        ...sharedRules,
      },
    },
    {
      files: ['**/*.{cts,mts,ts}'],
      ...js.configs.recommended,
      ...importFlatConfigs.typescript,
      ignores,
      languageOptions: {
        ...js.configs.recommended.languageOptions,
        ...importFlatConfigs.typescript.languageOptions,
        ecmaVersion: 'latest',
        sourceType,
        parser: tsEslint.parser,
        parserOptions: {
          ...importFlatConfigs.typescript.languageOptions?.parserOptions,
          project: [
            path.join(rootPath, 'tsconfig.json'),
            path.join(rootPath, 'tsconfig.test.json'),
          ],
          tsconfigRootDir: rootPath,
        },
      },
      plugins: {
        ...js.configs.recommended.plugins,
        ...importFlatConfigs.typescript.plugins,
        ...sharedPlugins,
        '@typescript-eslint': tsEslint.plugin,
      },
      rules: {
        ...js.configs.recommended.rules,
        ...importFlatConfigs.typescript.rules,
        ...sharedRules,
        '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
        '@typescript-eslint/consistent-type-assertions': [
          'error',
          { assertionStyle: 'as' },
        ],
        '@typescript-eslint/no-extraneous-class': 'off',
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
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_|^this$',
            ignoreRestSiblings: true,
            varsIgnorePattern: '^_',
          },
        ],
        // Disable the following rules because they don't play well with TypeScript.
        'dot-notation': 'off',
        'no-redeclare': 'off',
        'no-unused-vars': 'off',
        // Disable node plugin rules that can't resolve TypeScript imports.
        'n/no-missing-import': 'off',
        'n/no-missing-require': 'off',
      },
    },
    {
      files: ['**/*.d.{cts,mts,ts}'],
      ignores,
      rules: {
        'n/no-unpublished-import': 'off',
        // Disable the following rules because they don't play well with TypeScript.
        'n/no-missing-import': 'off',
        // Disable no-unused-vars for type definition files since they contain declarations.
        '@typescript-eslint/no-unused-vars': 'off',
        'no-unused-vars': 'off',
      },
    },
  ]
}

export default [
  gitIgnores,
  biomeIgnores,
  {
    ignores: [
      // Dot folders.
      '.*/**',
      // Nested directories.
      '**/coverage/**',
      '**/dist/**',
      '**/external/**',
      '**/node_modules/**',
      // Bundled packages.
      'packages/npm/**/package/**',
      // Registry paths.
      'registry/src/external/**/*.d.ts',
      'registry/dist/**',
      // Generated TypeScript files.
      '**/*.d.ts',
      '**/*.d.ts.map',
      '**/*.tsbuildinfo',
    ],
  },
  ...configs('script'),
  ...configs('module'),
  {
    // The external directory contains rollup-bundled dependencies that are
    // part of the published package. The n/no-unpublished-require rule doesn't
    // understand that these files are included via the "files" field, so we
    // disable it for registry/lib. The n/no-missing-require rule still runs
    // and will catch actual missing dependencies.
    files: ['registry/lib/**/*.js', 'registry/lib/**/*.cjs'],
    rules: {
      'n/no-unpublished-require': 'off',
    },
  },
  {
    // Relax rules for test files - testing code has different conventions
    files: ['test/**/*.ts', 'test/**/*.mts'],
    rules: {
      'n/no-missing-import': 'off',
      'import-x/no-unresolved': 'off',
      'line-comment-position': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-import-assign': 'off', // Tests intentionally reassign imports to test immutability
      'no-await-in-loop': 'off', // Tests often need to await in loops
    },
  },
  {
    // Relax rules for script files
    files: ['scripts/**/*.mjs', 'registry/scripts/**/*.mjs'],
    rules: {
      'n/no-process-exit': 'off',
      'no-await-in-loop': 'off',
    },
  },
]
