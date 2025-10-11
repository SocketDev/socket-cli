/**
 * @fileoverview Tests for build constants.
 *
 * Tests cover:
 * - Constant definitions and values
 * - Path resolution
 * - Environment-based configuration
 * - Lazy initialization
 *
 * Note: These tests validate build configuration consistency.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import constants from '../scripts/constants.mjs'

describe('build-constants', () => {
  describe('package names', () => {
    it('should define Socket CLI package name', () => {
      expect(constants.SOCKET_CLI_PACKAGE_NAME).toBe('socket')
    })

    it('should define legacy package name', () => {
      expect(constants.SOCKET_CLI_LEGACY_PACKAGE_NAME).toBe(
        '@socketsecurity/cli',
      )
    })

    it('should define Sentry package name', () => {
      expect(constants.SOCKET_CLI_SENTRY_PACKAGE_NAME).toBe(
        '@socketsecurity/cli-with-sentry',
      )
    })
  })

  describe('binary names', () => {
    it('should define main binary name', () => {
      expect(constants.SOCKET_CLI_BIN_NAME).toBe('socket')
    })

    it('should define npm wrapper binary', () => {
      expect(constants.SOCKET_CLI_NPM_BIN_NAME).toBe('socket-npm')
    })

    it('should define npx wrapper binary', () => {
      expect(constants.SOCKET_CLI_NPX_BIN_NAME).toBe('socket-npx')
    })

    it('should define pnpm wrapper binary', () => {
      expect(constants.SOCKET_CLI_PNPM_BIN_NAME).toBe('socket-pnpm')
    })

    it('should define yarn wrapper binary', () => {
      expect(constants.SOCKET_CLI_YARN_BIN_NAME).toBe('socket-yarn')
    })

    it('should define Sentry-instrumented binary names', () => {
      expect(constants.SOCKET_CLI_SENTRY_BIN_NAME).toBe('socket-with-sentry')
      expect(constants.SOCKET_CLI_SENTRY_NPM_BIN_NAME).toBe(
        'socket-npm-with-sentry',
      )
      expect(constants.SOCKET_CLI_SENTRY_NPX_BIN_NAME).toBe(
        'socket-npx-with-sentry',
      )
      expect(constants.SOCKET_CLI_SENTRY_PNPM_BIN_NAME).toBe(
        'socket-pnpm-with-sentry',
      )
      expect(constants.SOCKET_CLI_SENTRY_YARN_BIN_NAME).toBe(
        'socket-yarn-with-sentry',
      )
    })
  })

  describe('path constants', () => {
    it('should resolve root path', () => {
      expect(constants.rootPath).toBeDefined()
      expect(typeof constants.rootPath).toBe('string')
      expect(path.isAbsolute(constants.rootPath)).toBe(true)
      expect(existsSync(constants.rootPath)).toBe(true)
    })

    it('should resolve config path', () => {
      expect(constants.configPath).toBeDefined()
      expect(typeof constants.configPath).toBe('string')
      expect(normalizePath(constants.configPath).endsWith('.config')).toBe(true)
    })

    it('should resolve dist path', () => {
      expect(constants.distPath).toBeDefined()
      expect(typeof constants.distPath).toBe('string')
      expect(normalizePath(constants.distPath).endsWith('dist')).toBe(true)
    })

    it('should resolve external path', () => {
      expect(constants.externalPath).toBeDefined()
      expect(typeof constants.externalPath).toBe('string')
      expect(normalizePath(constants.externalPath).includes('external')).toBe(
        true,
      )
    })

    it('should resolve src path', () => {
      expect(constants.srcPath).toBeDefined()
      expect(typeof constants.srcPath).toBe('string')
      expect(normalizePath(constants.srcPath).endsWith('src')).toBe(true)
      expect(existsSync(constants.srcPath)).toBe(true)
    })

    it('should resolve root package.json path', () => {
      expect(constants.rootPackageJsonPath).toBeDefined()
      expect(typeof constants.rootPackageJsonPath).toBe('string')
      expect(
        normalizePath(constants.rootPackageJsonPath).endsWith('package.json'),
      ).toBe(true)
      expect(existsSync(constants.rootPackageJsonPath)).toBe(true)
    })

    it('should resolve root node_modules/.bin path', () => {
      expect(constants.rootNodeModulesBinPath).toBeDefined()
      expect(typeof constants.rootNodeModulesBinPath).toBe('string')
      expect(
        normalizePath(constants.rootNodeModulesBinPath).includes(
          'node_modules',
        ),
      ).toBe(true)
      expect(
        normalizePath(constants.rootNodeModulesBinPath).endsWith('.bin'),
      ).toBe(true)
    })

    it('should resolve socket registry path', () => {
      expect(constants.socketRegistryPath).toBeDefined()
      expect(typeof constants.socketRegistryPath).toBe('string')
    })
  })

  describe('shadow bin constants', () => {
    it('should define shadow npm bin', () => {
      expect(constants.SHADOW_NPM_BIN).toBe('shadow-npm-bin')
    })

    // Skip - SHADOW_NPM_INJECT constant has been removed
    it.skip('should define shadow npm inject', () => {
      expect(constants.SHADOW_NPM_INJECT).toBe('shadow-npm-inject')
    })

    it('should define shadow npx bin', () => {
      expect(constants.SHADOW_NPX_BIN).toBe('shadow-npx-bin')
    })

    it('should define shadow pnpm bin', () => {
      expect(constants.SHADOW_PNPM_BIN).toBe('shadow-pnpm-bin')
    })

    it('should define shadow yarn bin', () => {
      expect(constants.SHADOW_YARN_BIN).toBe('shadow-yarn-bin')
    })
  })

  describe('rollup constants', () => {
    it('should define rollup external suffix', () => {
      expect(constants.ROLLUP_EXTERNAL_SUFFIX).toBe('?commonjs-external')
    })
  })

  describe('environment constants', () => {
    it('should have ENV object', () => {
      expect(constants.ENV).toBeDefined()
      expect(typeof constants.ENV).toBe('object')
    })

    it('should have legacy build flag', () => {
      // May be undefined in non-build environments
      if (constants.ENV.INLINED_SOCKET_CLI_LEGACY_BUILD !== undefined) {
        expect(typeof constants.ENV.INLINED_SOCKET_CLI_LEGACY_BUILD).toBe(
          'boolean',
        )
      } else {
        expect(constants.ENV.INLINED_SOCKET_CLI_LEGACY_BUILD).toBeUndefined()
      }
    })

    it('should have published build flag', () => {
      // May be undefined in non-build environments
      if (constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD !== undefined) {
        expect(typeof constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD).toBe(
          'boolean',
        )
      } else {
        expect(constants.ENV.INLINED_SOCKET_CLI_PUBLISHED_BUILD).toBeUndefined()
      }
    })

    it('should have Sentry build flag', () => {
      // May be undefined in non-build environments
      if (constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD !== undefined) {
        expect(typeof constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD).toBe(
          'boolean',
        )
      } else {
        expect(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD).toBeUndefined()
      }
    })
  })

  describe('inlined constant names', () => {
    it('should define coana-tech CLI version constant', () => {
      expect(constants.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION).toBe(
        'INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION',
      )
    })

    it('should define cdxgen version constant', () => {
      expect(constants.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION).toBe(
        'INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION',
      )
    })

    it('should define Python version constant', () => {
      expect(constants.INLINED_SOCKET_CLI_PYTHON_VERSION).toBe(
        'INLINED_SOCKET_CLI_PYTHON_VERSION',
      )
    })

    it('should define Python build tag constant', () => {
      expect(constants.INLINED_SOCKET_CLI_PYTHON_BUILD_TAG).toBe(
        'INLINED_SOCKET_CLI_PYTHON_BUILD_TAG',
      )
    })

    it('should define synp version constant', () => {
      expect(constants.INLINED_SOCKET_CLI_SYNP_VERSION).toBe(
        'INLINED_SOCKET_CLI_SYNP_VERSION',
      )
    })

    it('should define homepage constant', () => {
      expect(constants.INLINED_SOCKET_CLI_HOMEPAGE).toBe(
        'INLINED_SOCKET_CLI_HOMEPAGE',
      )
    })

    it('should define name constant', () => {
      expect(constants.INLINED_SOCKET_CLI_NAME).toBe('INLINED_SOCKET_CLI_NAME')
    })

    it('should define version constant', () => {
      expect(constants.INLINED_SOCKET_CLI_VERSION).toBe(
        'INLINED_SOCKET_CLI_VERSION',
      )
    })

    it('should define version hash constant', () => {
      expect(constants.INLINED_SOCKET_CLI_VERSION_HASH).toBe(
        'INLINED_SOCKET_CLI_VERSION_HASH',
      )
    })
  })

  describe('other constants', () => {
    // Skip - INSTRUMENT_WITH_SENTRY constant has been removed
    it.skip('should define instrument-with-sentry constant', () => {
      expect(constants.INSTRUMENT_WITH_SENTRY).toBe('instrument-with-sentry')
    })

    it('should define node_modules path constant', () => {
      expect(constants.SLASH_NODE_MODULES_SLASH).toBe('/node_modules/')
    })

    it('should define constants name', () => {
      expect(constants.CONSTANTS).toBe('constants')
    })
  })

  describe('path relationships', () => {
    it('should have config path inside root path', () => {
      expect(
        normalizePath(constants.configPath).startsWith(
          normalizePath(constants.rootPath),
        ),
      ).toBe(true)
    })

    it('should have dist path inside root path', () => {
      expect(
        normalizePath(constants.distPath).startsWith(
          normalizePath(constants.rootPath),
        ),
      ).toBe(true)
    })

    it('should have external path inside dist path', () => {
      expect(
        normalizePath(constants.externalPath).startsWith(
          normalizePath(constants.distPath),
        ),
      ).toBe(true)
    })

    it('should have src path inside root path', () => {
      expect(
        normalizePath(constants.srcPath).startsWith(
          normalizePath(constants.rootPath),
        ),
      ).toBe(true)
    })

    it('should have package.json inside root path', () => {
      expect(
        normalizePath(constants.rootPackageJsonPath).startsWith(
          normalizePath(constants.rootPath),
        ),
      ).toBe(true)
    })
  })

  describe('lazy initialization', () => {
    it('should initialize ENV lazily', () => {
      // Access ENV multiple times - should return same object
      const env1 = constants.ENV
      const env2 = constants.ENV
      expect(env1).toBe(env2)
    })

    it('should initialize paths lazily', () => {
      // Access paths multiple times - should return same values
      const rootPath1 = constants.rootPath
      const rootPath2 = constants.rootPath
      expect(rootPath1).toBe(rootPath2)
    })
  })
})
