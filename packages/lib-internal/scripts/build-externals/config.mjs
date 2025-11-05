/**
 * @fileoverview External package configuration.
 * Defines which packages need bundling and their scopes.
 */

// Define which packages need bundling (ones that are actual npm packages).
export const externalPackages = [
  // NPM internals
  { name: 'cacache', bundle: true },
  { name: 'pacote', bundle: true },
  { name: 'make-fetch-happen', bundle: true },
  { name: 'libnpmexec', bundle: true },
  { name: 'libnpmpack', bundle: true },
  { name: 'npm-package-arg', bundle: true },
  { name: 'normalize-package-data', bundle: true },
  // Utilities
  { name: 'debug', bundle: true },
  { name: 'del', bundle: true },
  { name: 'fast-glob', bundle: true },
  { name: 'fast-sort', bundle: true },
  { name: 'get-east-asian-width', bundle: true },
  { name: 'picomatch', bundle: true },
  { name: 'semver', bundle: true },
  { name: 'spdx-correct', bundle: true },
  { name: 'spdx-expression-parse', bundle: true },
  { name: 'streaming-iterables', bundle: true },
  { name: 'validate-npm-package-name', bundle: true },
  { name: 'which', bundle: true },
  { name: 'yargs-parser', bundle: true },
  { name: 'yoctocolors-cjs', bundle: true },
  // Used by socket-cli (dist/cli.js has minified zod).
  { name: 'zod', bundle: true },
]

// Scoped packages need special handling.
export const scopedPackages = [
  {
    scope: '@npmcli',
    packages: ['package-json', 'promise-spawn'],
    bundle: true,
    subpaths: ['package-json/lib/read-package.js', 'package-json/lib/sort.js'],
  },
  {
    scope: '@inquirer',
    packages: [
      'checkbox',
      'confirm',
      'core',
      'input',
      'password',
      'prompts',
      'search',
      'select',
    ],
    optional: true,
  },
  {
    scope: '@socketregistry',
    packages: ['packageurl-js', 'is-unicode-supported', 'yocto-spinner'],
    optional: true,
  },
  { scope: '@yarnpkg', name: 'extensions', bundle: true },
]
