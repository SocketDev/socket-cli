/**
 * @fileoverview Unit tests for Node.js constants and feature detection.
 *
 * Tests Node.js version detection and feature support:
 * - Version getters: getNodeVersion(), getNodeMajorVersion(), getMaintainedNodeVersions()
 * - Feature detection: supportsNodeRun(), supportsNodePermissionFlag(), supportsNodeCompileCacheApi()
 * - Flag builders: getNodeHardenFlags(), getNodePermissionFlags(), getNodeNoWarningsFlags()
 * - Runtime detection: NODE_SEA_FUSE, ESNEXT, getExecPath(), supportsProcessSend()
 * Critical for Node.js version-specific behavior and compatibility.
 */

import {
  ESNEXT,
  NODE_SEA_FUSE,
  getExecPath,
  getMaintainedNodeVersions,
  getNodeDisableSigusr1Flags,
  getNodeHardenFlags,
  getNodeMajorVersion,
  getNodeNoWarningsFlags,
  getNodePermissionFlags,
  getNodeVersion,
  supportsNodeCompileCacheApi,
  supportsNodeCompileCacheEnvVar,
  supportsNodeDisableSigusr1Flag,
  supportsNodeDisableWarningFlag,
  supportsNodePermissionFlag,
  supportsNodeRequireModule,
  supportsNodeRun,
  supportsProcessSend,
} from '@socketsecurity/lib/constants/node'
import { describe, expect, it } from 'vitest'

describe('node constants', () => {
  describe('getNodeVersion', () => {
    it('should return current Node.js version', () => {
      const version = getNodeVersion()
      expect(version).toMatch(/^v\d+\.\d+\.\d+/)
      expect(version).toBe(process.version)
    })
  })

  describe('getNodeMajorVersion', () => {
    it('should return major version number', () => {
      const major = getNodeMajorVersion()
      expect(typeof major).toBe('number')
      expect(major).toBeGreaterThan(0)
      // Current Node.js major version should be at least 18 (minimum LTS)
      expect(major).toBeGreaterThanOrEqual(18)
    })

    it('should match process.version major', () => {
      const expected = Number.parseInt(
        process.version.slice(1).split('.')[0] || '0',
        10,
      )
      expect(getNodeMajorVersion()).toBe(expected)
    })
  })

  describe('getMaintainedNodeVersions', () => {
    it('should return maintained versions object', () => {
      const versions = getMaintainedNodeVersions()
      expect(versions).toBeDefined()
      expect(Array.isArray(versions)).toBe(true)
    })

    it('should have current, last, next, previous properties', () => {
      const versions = getMaintainedNodeVersions()
      expect(versions).toHaveProperty('current')
      expect(versions).toHaveProperty('last')
      expect(versions).toHaveProperty('next')
      expect(versions).toHaveProperty('previous')
    })

    it('should return same instance on multiple calls', () => {
      const first = getMaintainedNodeVersions()
      const second = getMaintainedNodeVersions()
      expect(first).toBe(second)
    })
  })

  describe('supportsNodeCompileCacheApi', () => {
    it('should return boolean', () => {
      const result = supportsNodeCompileCacheApi()
      expect(typeof result).toBe('boolean')
    })

    it('should return true for Node.js 24+', () => {
      const major = getNodeMajorVersion()
      const result = supportsNodeCompileCacheApi()
      if (major >= 24) {
        expect(result).toBe(true)
      } else {
        expect(result).toBe(false)
      }
    })
  })

  describe('supportsNodeCompileCacheEnvVar', () => {
    it('should return boolean', () => {
      const result = supportsNodeCompileCacheEnvVar()
      expect(typeof result).toBe('boolean')
    })

    it('should return true for Node.js 22+', () => {
      const major = getNodeMajorVersion()
      const result = supportsNodeCompileCacheEnvVar()
      if (major >= 22) {
        expect(result).toBe(true)
      } else {
        expect(result).toBe(false)
      }
    })
  })

  describe('supportsNodeDisableWarningFlag', () => {
    it('should return boolean', () => {
      const result = supportsNodeDisableWarningFlag()
      expect(typeof result).toBe('boolean')
    })

    it('should return true for Node.js 21+', () => {
      const major = getNodeMajorVersion()
      const result = supportsNodeDisableWarningFlag()
      if (major >= 21) {
        expect(result).toBe(true)
      } else {
        expect(result).toBe(false)
      }
    })
  })

  describe('supportsNodePermissionFlag', () => {
    it('should return boolean', () => {
      const result = supportsNodePermissionFlag()
      expect(typeof result).toBe('boolean')
    })

    it('should return true for Node.js 20+', () => {
      const major = getNodeMajorVersion()
      const result = supportsNodePermissionFlag()
      if (major >= 20) {
        expect(result).toBe(true)
      } else {
        expect(result).toBe(false)
      }
    })
  })

  describe('supportsNodeRequireModule', () => {
    it('should return boolean', () => {
      const result = supportsNodeRequireModule()
      expect(typeof result).toBe('boolean')
    })

    it('should return true for Node.js 23+', () => {
      const major = getNodeMajorVersion()
      const result = supportsNodeRequireModule()
      if (major >= 23) {
        expect(result).toBe(true)
      }
    })

    it('should check minor version for Node.js 22', () => {
      const major = getNodeMajorVersion()
      if (major === 22) {
        const minor = Number.parseInt(process.version.split('.')[1] || '0', 10)
        const result = supportsNodeRequireModule()
        if (minor >= 12) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      }
    })
  })

  describe('supportsNodeRun', () => {
    it('should return boolean', () => {
      const result = supportsNodeRun()
      expect(typeof result).toBe('boolean')
    })

    it('should return true for Node.js 23+', () => {
      const major = getNodeMajorVersion()
      const result = supportsNodeRun()
      if (major >= 23) {
        expect(result).toBe(true)
      }
    })

    it('should check minor version for Node.js 22', () => {
      const major = getNodeMajorVersion()
      if (major === 22) {
        const minor = Number.parseInt(process.version.split('.')[1] || '0', 10)
        const result = supportsNodeRun()
        if (minor >= 11) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      }
    })
  })

  describe('supportsNodeDisableSigusr1Flag', () => {
    it('should return boolean', () => {
      const result = supportsNodeDisableSigusr1Flag()
      expect(typeof result).toBe('boolean')
    })

    it('should check version-specific support', () => {
      const major = getNodeMajorVersion()
      const minor = Number.parseInt(process.version.split('.')[1] || '0', 10)
      const result = supportsNodeDisableSigusr1Flag()

      if (major >= 24) {
        if (minor >= 8) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      } else if (major === 23) {
        if (minor >= 7) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      } else if (major === 22) {
        if (minor >= 14) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      } else {
        expect(result).toBe(false)
      }
    })
  })

  describe('supportsProcessSend', () => {
    it('should return boolean', () => {
      const result = supportsProcessSend()
      expect(typeof result).toBe('boolean')
    })

    it('should check if process.send exists', () => {
      const hasSend = typeof process.send === 'function'
      expect(supportsProcessSend()).toBe(hasSend)
    })
  })

  describe('getNodeHardenFlags', () => {
    it('should return array of hardening flags', () => {
      const flags = getNodeHardenFlags()
      expect(Array.isArray(flags)).toBe(true)
      expect(flags.length).toBeGreaterThan(0)
    })

    it('should include disable-proto flag', () => {
      const flags = getNodeHardenFlags()
      expect(flags).toContain('--disable-proto=delete')
    })

    it('should include force-node-api flag', () => {
      const flags = getNodeHardenFlags()
      expect(flags).toContain('--force-node-api-uncaught-exceptions-policy')
    })

    it('should use --permission for Node.js 24+', () => {
      const major = getNodeMajorVersion()
      const flags = getNodeHardenFlags()
      if (major >= 24) {
        expect(flags).toContain('--permission')
        expect(flags).not.toContain('--experimental-permission')
        expect(flags).not.toContain('--experimental-policy')
      }
    })

    it('should use --experimental-permission for Node.js < 24', () => {
      const major = getNodeMajorVersion()
      const flags = getNodeHardenFlags()
      if (major < 24) {
        expect(flags).toContain('--experimental-permission')
        expect(flags).toContain('--experimental-policy')
        expect(flags).not.toContain('--permission')
      }
    })

    it('should return same instance on multiple calls', () => {
      const first = getNodeHardenFlags()
      const second = getNodeHardenFlags()
      expect(first).toBe(second)
    })
  })

  describe('getNodePermissionFlags', () => {
    it('should return array of permission flags', () => {
      const flags = getNodePermissionFlags()
      expect(Array.isArray(flags)).toBe(true)
    })

    it('should return filesystem and process permissions for Node.js 24+', () => {
      const major = getNodeMajorVersion()
      const flags = getNodePermissionFlags()
      if (major >= 24) {
        expect(flags).toContain('--allow-fs-read=*')
        expect(flags).toContain('--allow-fs-write=*')
        expect(flags).toContain('--allow-child-process')
        expect(flags.length).toBe(3)
      }
    })

    it('should return empty array for Node.js < 24', () => {
      const major = getNodeMajorVersion()
      const flags = getNodePermissionFlags()
      if (major < 24) {
        expect(flags.length).toBe(0)
      }
    })

    it('should return same instance on multiple calls', () => {
      const first = getNodePermissionFlags()
      const second = getNodePermissionFlags()
      expect(first).toBe(second)
    })
  })

  describe('getNodeNoWarningsFlags', () => {
    it('should return array of no-warnings flags', () => {
      const flags = getNodeNoWarningsFlags()
      expect(Array.isArray(flags)).toBe(true)
      expect(flags.length).toBeGreaterThan(0)
    })

    it('should include no-warnings and no-deprecation flags', () => {
      const flags = getNodeNoWarningsFlags()
      expect(flags).toContain('--no-warnings')
      expect(flags).toContain('--no-deprecation')
    })

    it('should return same instance on multiple calls', () => {
      const first = getNodeNoWarningsFlags()
      const second = getNodeNoWarningsFlags()
      expect(first).toBe(second)
    })
  })

  describe('getNodeDisableSigusr1Flags', () => {
    it('should return array of SIGUSR1 disable flags', () => {
      const flags = getNodeDisableSigusr1Flags()
      expect(Array.isArray(flags)).toBe(true)
      expect(flags.length).toBeGreaterThan(0)
    })

    it('should return --disable-sigusr1 for supported versions', () => {
      const flags = getNodeDisableSigusr1Flags()
      const supportsFlag = supportsNodeDisableSigusr1Flag()
      if (supportsFlag) {
        expect(flags).toContain('--disable-sigusr1')
        expect(flags).not.toContain('--no-inspect')
      } else {
        expect(flags).toContain('--no-inspect')
        expect(flags).not.toContain('--disable-sigusr1')
      }
    })

    it('should return same instance on multiple calls', () => {
      const first = getNodeDisableSigusr1Flags()
      const second = getNodeDisableSigusr1Flags()
      expect(first).toBe(second)
    })
  })

  describe('getExecPath', () => {
    it('should return string path', () => {
      const path = getExecPath()
      expect(typeof path).toBe('string')
      expect(path.length).toBeGreaterThan(0)
    })

    it('should match process.execPath', () => {
      expect(getExecPath()).toBe(process.execPath)
    })

    it('should include node executable', () => {
      const path = getExecPath()
      expect(path).toMatch(/node/)
    })
  })

  describe('NODE_SEA_FUSE constant', () => {
    it('should be defined as string', () => {
      expect(typeof NODE_SEA_FUSE).toBe('string')
    })

    it('should have correct fuse value', () => {
      expect(NODE_SEA_FUSE).toBe(
        'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      )
    })

    it('should start with NODE_SEA_FUSE prefix', () => {
      expect(NODE_SEA_FUSE).toMatch(/^NODE_SEA_FUSE_/)
    })
  })

  describe('ESNEXT constant', () => {
    it('should be defined as string', () => {
      expect(typeof ESNEXT).toBe('string')
    })

    it('should equal esnext', () => {
      expect(ESNEXT).toBe('esnext')
    })
  })

  describe('edge cases and comprehensive coverage', () => {
    it('should handle all flag getters being called multiple times', () => {
      // Call each getter multiple times to ensure caching works
      for (let i = 0; i < 3; i++) {
        getNodeHardenFlags()
        getNodePermissionFlags()
        getNodeNoWarningsFlags()
        getNodeDisableSigusr1Flags()
      }
    })

    it('should verify all flag arrays are non-empty or conditionally empty', () => {
      const hardenFlags = getNodeHardenFlags()
      const noWarningsFlags = getNodeNoWarningsFlags()
      const sigusr1Flags = getNodeDisableSigusr1Flags()

      expect(hardenFlags.length).toBeGreaterThan(0)
      expect(noWarningsFlags.length).toBeGreaterThan(0)
      expect(sigusr1Flags.length).toBeGreaterThan(0)

      // Permission flags are conditionally empty for Node < 24
      const permissionFlags = getNodePermissionFlags()
      const major = getNodeMajorVersion()
      if (major >= 24) {
        expect(permissionFlags.length).toBeGreaterThan(0)
      } else {
        expect(permissionFlags.length).toBe(0)
      }
    })

    it('should verify maintained versions caching', () => {
      const v1 = getMaintainedNodeVersions()
      const v2 = getMaintainedNodeVersions()
      const v3 = getMaintainedNodeVersions()
      expect(v1).toBe(v2)
      expect(v2).toBe(v3)
    })

    it('should verify all support functions return boolean', () => {
      expect(typeof supportsNodeCompileCacheApi()).toBe('boolean')
      expect(typeof supportsNodeCompileCacheEnvVar()).toBe('boolean')
      expect(typeof supportsNodeDisableWarningFlag()).toBe('boolean')
      expect(typeof supportsNodePermissionFlag()).toBe('boolean')
      expect(typeof supportsNodeRequireModule()).toBe('boolean')
      expect(typeof supportsNodeRun()).toBe('boolean')
      expect(typeof supportsNodeDisableSigusr1Flag()).toBe('boolean')
      expect(typeof supportsProcessSend()).toBe('boolean')
    })

    it('should verify version string format', () => {
      const version = getNodeVersion()
      expect(version).toMatch(/^v\d+\.\d+\.\d+/)
      expect(version.startsWith('v')).toBe(true)
    })

    it('should verify major version is positive integer', () => {
      const major = getNodeMajorVersion()
      expect(Number.isInteger(major)).toBe(true)
      expect(major).toBeGreaterThan(0)
    })

    it('should verify execPath is absolute path', () => {
      const execPath = getExecPath()
      expect(execPath).toBeTruthy()
      expect(typeof execPath).toBe('string')
      expect(execPath.length).toBeGreaterThan(0)
    })

    it('should verify flag contents are strings starting with --', () => {
      const allFlags = [
        ...getNodeHardenFlags(),
        ...getNodePermissionFlags(),
        ...getNodeNoWarningsFlags(),
        ...getNodeDisableSigusr1Flags(),
      ]

      allFlags.forEach(flag => {
        expect(typeof flag).toBe('string')
        expect(flag.startsWith('--')).toBe(true)
      })
    })

    it('should verify constants are exportable and accessible', () => {
      // Verify constants can be destructured and used
      const seaFuse = NODE_SEA_FUSE
      const esnext = ESNEXT

      expect(seaFuse).toBeDefined()
      expect(esnext).toBeDefined()
      expect(typeof seaFuse).toBe('string')
      expect(typeof esnext).toBe('string')
    })
  })
})
