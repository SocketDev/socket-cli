/**
 * Unit tests for bootstrap shared path resolution.
 *
 * Bootstrap-only path helpers — run before the main ENV module loads,
 * so they read process.env directly. Tests cover env-override + default
 * path construction for every getter.
 *
 * Related Files:
 * - src/bootstrap/shared/paths.mts
 */

import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getBootstrapBinaryDir,
  getCliEntryPoint,
  getCliPackageDir,
  getCliPackageName,
  getDlxDir,
  getRegistryUrl,
  getSocketHome,
} from '../../../../src/bootstrap/shared/paths.mts'

const SAVED_KEYS = [
  'SOCKET_HOME',
  'SOCKET_NPM_REGISTRY',
  'NPM_REGISTRY',
  'SOCKET_CLI_PACKAGE',
] as const

describe('bootstrap/shared/paths', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.create(null)
    for (const key of SAVED_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of SAVED_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key]
      } else {
        delete process.env[key]
      }
    }
  })

  describe('getSocketHome', () => {
    it('uses SOCKET_HOME when set', () => {
      process.env['SOCKET_HOME'] = '/custom/socket-home'
      expect(getSocketHome()).toBe('/custom/socket-home')
    })

    it('falls back to ~/.socket when SOCKET_HOME is not set', () => {
      const result = getSocketHome()
      expect(result).toContain('.socket')
    })

    it('falls back when SOCKET_HOME is empty string', () => {
      process.env['SOCKET_HOME'] = ''
      const result = getSocketHome()
      expect(result).toContain('.socket')
    })
  })

  describe('getBootstrapBinaryDir', () => {
    it('appends _cli to the socket home', () => {
      process.env['SOCKET_HOME'] = '/x'
      expect(getBootstrapBinaryDir()).toBe(path.join('/x', '_cli'))
    })
  })

  describe('getDlxDir', () => {
    it('appends _dlx to the socket home', () => {
      process.env['SOCKET_HOME'] = '/x'
      expect(getDlxDir()).toBe(path.join('/x', '_dlx'))
    })
  })

  describe('getCliPackageDir', () => {
    it('appends cli to the DLX dir', () => {
      process.env['SOCKET_HOME'] = '/x'
      expect(getCliPackageDir()).toBe(path.join('/x', '_dlx', 'cli'))
    })
  })

  describe('getCliEntryPoint', () => {
    it('appends dist/cli.js to the CLI package dir', () => {
      process.env['SOCKET_HOME'] = '/x'
      expect(getCliEntryPoint()).toBe(
        path.join('/x', '_dlx', 'cli', 'dist', 'cli.js'),
      )
    })
  })

  describe('getRegistryUrl', () => {
    it('uses SOCKET_NPM_REGISTRY when set', () => {
      process.env['SOCKET_NPM_REGISTRY'] = 'https://socket-registry.example/'
      expect(getRegistryUrl()).toBe('https://socket-registry.example/')
    })

    it('uses NPM_REGISTRY when SOCKET_NPM_REGISTRY is missing', () => {
      process.env['NPM_REGISTRY'] = 'https://npm-registry.example/'
      expect(getRegistryUrl()).toBe('https://npm-registry.example/')
    })

    it('falls back to the public npm registry', () => {
      expect(getRegistryUrl()).toBe('https://registry.npmjs.org')
    })

    it('prefers SOCKET_NPM_REGISTRY over NPM_REGISTRY', () => {
      process.env['SOCKET_NPM_REGISTRY'] = 'https://socket-r.example/'
      process.env['NPM_REGISTRY'] = 'https://npm-r.example/'
      expect(getRegistryUrl()).toBe('https://socket-r.example/')
    })
  })

  describe('getCliPackageName', () => {
    it('uses SOCKET_CLI_PACKAGE when set', () => {
      process.env['SOCKET_CLI_PACKAGE'] = '@my-org/socket'
      expect(getCliPackageName()).toBe('@my-org/socket')
    })

    it('falls back to @socketsecurity/cli', () => {
      expect(getCliPackageName()).toBe('@socketsecurity/cli')
    })
  })
})
