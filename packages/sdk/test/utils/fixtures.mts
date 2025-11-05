/** @fileoverview Test data fixtures and configurations. */

/**
 * Common test package.json configurations to reduce duplication across test files.
 */
export const TEST_PACKAGE_CONFIGS = {
  expressBasic: {
    name: 'test-package',
    version: '1.0.0',
    dependencies: {
      express: '^4.18.0',
    },
  },
  lodashBasic: {
    name: 'test-package',
    version: '1.0.0',
    dependencies: {
      lodash: '^4.17.21',
    },
  },
  multiPackage: {
    name: 'test-package',
    version: '1.0.0',
    dependencies: {
      express: '^4.18.0',
      lodash: '^4.17.21',
    },
  },
} as const
