/**
 * Unit tests for package constants.
 *
 * Purpose:
 * Tests the package and binary name constants for Socket CLI.
 *
 * Test Coverage:
 * - Package manifest file constants
 * - Directory name constants
 * - File extension constants
 * - Package name constants
 * - Binary name constants
 *
 * Related Files:
 * - constants/packages.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  BLESSED,
  BLESSED_CONTRIB,
  EXT_LOCK,
  EXT_LOCKB,
  NODE_MODULES,
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  PYTHON_MIN_VERSION,
  SENTRY_NODE,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_BIN_NAME_ALIAS,
  SOCKET_CLI_LEGACY_PACKAGE_NAME,
  SOCKET_CLI_NPM_BIN_NAME,
  SOCKET_CLI_NPX_BIN_NAME,
  SOCKET_CLI_PACKAGE_NAME,
  SOCKET_CLI_PNPM_BIN_NAME,
  SOCKET_CLI_SENTRY_BIN_NAME,
  SOCKET_CLI_SENTRY_BIN_NAME_ALIAS,
  SOCKET_CLI_SENTRY_NPM_BIN_NAME,
  SOCKET_CLI_SENTRY_NPX_BIN_NAME,
  SOCKET_CLI_SENTRY_PACKAGE_NAME,
  SOCKET_CLI_SENTRY_PNPM_BIN_NAME,
  SOCKET_CLI_SENTRY_YARN_BIN_NAME,
  SOCKET_CLI_YARN_BIN_NAME,
  SOCKET_DESCRIPTION,
  SOCKET_DESCRIPTION_WITH_SENTRY,
  SOCKET_SECURITY_REGISTRY,
  YARN_LOCK,
} from '../../../src/constants/packages.mts'

describe('packages constants', () => {
  describe('package manifest file constants', () => {
    it('has PACKAGE_JSON constant', () => {
      expect(PACKAGE_JSON).toBe('package.json')
    })

    it('has PACKAGE_LOCK_JSON constant', () => {
      expect(PACKAGE_LOCK_JSON).toBe('package-lock.json')
    })

    it('has PNPM_LOCK_YAML constant', () => {
      expect(PNPM_LOCK_YAML).toBe('pnpm-lock.yaml')
    })

    it('has YARN_LOCK constant', () => {
      expect(YARN_LOCK).toBe('yarn.lock')
    })
  })

  describe('directory name constants', () => {
    it('has NODE_MODULES constant', () => {
      expect(NODE_MODULES).toBe('node_modules')
    })
  })

  describe('file extension constants', () => {
    it('has EXT_LOCK constant', () => {
      expect(EXT_LOCK).toBe('.lock')
    })

    it('has EXT_LOCKB constant', () => {
      expect(EXT_LOCKB).toBe('.lockb')
    })
  })

  describe('npm version constants', () => {
    it('has NPM_BUGGY_OVERRIDES_PATCHED_VERSION constant', () => {
      expect(NPM_BUGGY_OVERRIDES_PATCHED_VERSION).toBe('11.2.0')
    })
  })

  describe('external package name constants', () => {
    it('has BLESSED constant', () => {
      expect(BLESSED).toBe('blessed')
    })

    it('has BLESSED_CONTRIB constant', () => {
      expect(BLESSED_CONTRIB).toBe('blessed-contrib')
    })

    it('has SENTRY_NODE constant', () => {
      expect(SENTRY_NODE).toBe('@sentry/node')
    })

    it('has SOCKET_SECURITY_REGISTRY constant', () => {
      expect(SOCKET_SECURITY_REGISTRY).toBe('@socketsecurity/registry')
    })
  })

  describe('Socket CLI package name constants', () => {
    it('has SOCKET_CLI_PACKAGE_NAME constant', () => {
      expect(SOCKET_CLI_PACKAGE_NAME).toBe('socket')
    })

    it('has SOCKET_CLI_LEGACY_PACKAGE_NAME constant', () => {
      expect(SOCKET_CLI_LEGACY_PACKAGE_NAME).toBe('socket-npm')
    })

    it('has SOCKET_CLI_SENTRY_PACKAGE_NAME constant', () => {
      expect(SOCKET_CLI_SENTRY_PACKAGE_NAME).toBe(
        '@socketsecurity/cli-with-sentry',
      )
    })
  })

  describe('Socket CLI binary name constants', () => {
    it('has SOCKET_CLI_BIN_NAME constant', () => {
      expect(SOCKET_CLI_BIN_NAME).toBe('socket')
    })

    it('has SOCKET_CLI_BIN_NAME_ALIAS constant', () => {
      expect(SOCKET_CLI_BIN_NAME_ALIAS).toBe('socket-dev')
    })

    it('has SOCKET_CLI_NPM_BIN_NAME constant', () => {
      expect(SOCKET_CLI_NPM_BIN_NAME).toBe('socket-npm')
    })

    it('has SOCKET_CLI_NPX_BIN_NAME constant', () => {
      expect(SOCKET_CLI_NPX_BIN_NAME).toBe('socket-npx')
    })

    it('has SOCKET_CLI_PNPM_BIN_NAME constant', () => {
      expect(SOCKET_CLI_PNPM_BIN_NAME).toBe('socket-pnpm')
    })

    it('has SOCKET_CLI_YARN_BIN_NAME constant', () => {
      expect(SOCKET_CLI_YARN_BIN_NAME).toBe('socket-yarn')
    })
  })

  describe('Socket CLI Sentry binary name constants', () => {
    it('has SOCKET_CLI_SENTRY_BIN_NAME constant', () => {
      expect(SOCKET_CLI_SENTRY_BIN_NAME).toBe('@socketsecurity/cli-with-sentry')
    })

    it('has SOCKET_CLI_SENTRY_BIN_NAME_ALIAS constant', () => {
      expect(SOCKET_CLI_SENTRY_BIN_NAME_ALIAS).toBe('socket-dev-with-sentry')
    })

    it('has SOCKET_CLI_SENTRY_NPM_BIN_NAME constant', () => {
      expect(SOCKET_CLI_SENTRY_NPM_BIN_NAME).toBe(
        '@socketsecurity/cli-with-sentry-npm',
      )
    })

    it('has SOCKET_CLI_SENTRY_NPX_BIN_NAME constant', () => {
      expect(SOCKET_CLI_SENTRY_NPX_BIN_NAME).toBe(
        '@socketsecurity/cli-with-sentry-npx',
      )
    })

    it('has SOCKET_CLI_SENTRY_PNPM_BIN_NAME constant', () => {
      expect(SOCKET_CLI_SENTRY_PNPM_BIN_NAME).toBe(
        '@socketsecurity/cli-with-sentry-pnpm',
      )
    })

    it('has SOCKET_CLI_SENTRY_YARN_BIN_NAME constant', () => {
      expect(SOCKET_CLI_SENTRY_YARN_BIN_NAME).toBe(
        '@socketsecurity/cli-with-sentry-yarn',
      )
    })
  })

  describe('description constants', () => {
    it('has SOCKET_DESCRIPTION constant', () => {
      expect(SOCKET_DESCRIPTION).toBe('CLI for Socket.dev')
    })

    it('has SOCKET_DESCRIPTION_WITH_SENTRY constant', () => {
      expect(SOCKET_DESCRIPTION_WITH_SENTRY).toContain(SOCKET_DESCRIPTION)
      expect(SOCKET_DESCRIPTION_WITH_SENTRY).toContain('Sentry')
    })
  })

  describe('Python version constants', () => {
    it('has PYTHON_MIN_VERSION constant', () => {
      expect(PYTHON_MIN_VERSION).toBe('3.9.0')
    })
  })
})
