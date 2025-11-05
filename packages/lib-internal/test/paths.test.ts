/**
 * @fileoverview Unit tests for Socket ecosystem path utilities.
 *
 * Tests Socket-specific directory path getters for caching and storage:
 * - getSocketHomePath() / getSocketUserDir() - base ~/.socket directory
 * - getSocketAppDir() - application directory
 * - getSocketAppCacheDir() - app-level cache storage
 * - getSocketAppCacheTtlDir() - TTL-based cache directory
 * - getSocketCacacheDir() - cacache (content-addressable cache) directory
 * - getSocketCliDir() - CLI-specific directory
 * - getSocketDlxDir() - dlx (download and execute) directory
 * - getSocketRegistryDir() - registry data storage
 * - getSocketRegistryGithubCacheDir() - GitHub API response cache
 * Tests validate path existence, normalization, cross-platform consistency, and aliasing.
 * These paths are critical for Socket tool state management and caching strategies.
 */

import {
  getSocketAppCacheDir,
  getSocketAppCacheTtlDir,
  getSocketAppDir,
  getSocketCacacheDir,
  getSocketCliDir,
  getSocketDlxDir,
  getSocketHomePath,
  getSocketRegistryDir,
  getSocketRegistryGithubCacheDir,
  getSocketUserDir,
} from '@socketsecurity/lib/paths'
import { describe, expect, it } from 'vitest'

describe('paths', () => {
  describe('getSocketHomePath', () => {
    it('should return the Socket home directory', () => {
      const result = getSocketHomePath()
      expect(result).toBeTruthy()
      expect(result).toContain('.socket')
      expect(typeof result).toBe('string')
    })

    it('should be an alias for getSocketUserDir', () => {
      const homePath = getSocketHomePath()
      const userDir = getSocketUserDir()
      expect(homePath).toBe(userDir)
    })

    it('should return normalized path', () => {
      const result = getSocketHomePath()
      expect(result).not.toContain('\\')
      if (process.platform === 'win32') {
        expect(result).toMatch(/^[A-Za-z]:\//)
      } else {
        expect(result).toMatch(/^\//)
      }
    })
  })

  describe('getSocketUserDir', () => {
    it('should return the Socket user directory', () => {
      const result = getSocketUserDir()
      expect(result).toBeTruthy()
      expect(result).toContain('.socket')
      expect(typeof result).toBe('string')
    })

    it('should end with .socket directory', () => {
      const result = getSocketUserDir()
      expect(result).toMatch(/\.socket$/)
    })

    it('should be absolute path', () => {
      const result = getSocketUserDir()
      if (process.platform === 'win32') {
        expect(result).toMatch(/^[A-Za-z]:\//)
      } else {
        expect(result).toMatch(/^\//)
      }
    })

    it('should use forward slashes', () => {
      const result = getSocketUserDir()
      expect(result).not.toContain('\\')
    })
  })

  describe('getSocketAppDir', () => {
    it('should return app directory with underscore prefix', () => {
      const result = getSocketAppDir('myapp')
      expect(result).toContain('.socket/_myapp')
    })

    it('should work with different app names', () => {
      const app1 = getSocketAppDir('app1')
      const app2 = getSocketAppDir('app2')
      expect(app1).toContain('_app1')
      expect(app2).toContain('_app2')
      expect(app1).not.toBe(app2)
    })

    it('should return normalized path', () => {
      const result = getSocketAppDir('test')
      expect(result).not.toContain('\\')
    })

    it('should handle empty app name', () => {
      const result = getSocketAppDir('')
      expect(result).toContain('.socket/_')
      expect(result).toMatch(/\/_$/)
    })

    it('should handle app name with special characters', () => {
      const result = getSocketAppDir('my-app.test')
      expect(result).toContain('_my-app.test')
    })

    it('should be under Socket user directory', () => {
      const userDir = getSocketUserDir()
      const appDir = getSocketAppDir('test')
      expect(appDir).toContain(userDir)
    })
  })

  describe('getSocketCacacheDir', () => {
    it('should return cacache directory', () => {
      const result = getSocketCacacheDir()
      expect(result).toContain('.socket/_cacache')
    })

    it('should return normalized path', () => {
      const result = getSocketCacacheDir()
      expect(result).not.toContain('\\')
    })

    it('should be under Socket user directory when env var not set', () => {
      const userDir = getSocketUserDir()
      const cacacheDir = getSocketCacacheDir()
      expect(cacacheDir).toContain(userDir)
    })
  })

  describe('getSocketDlxDir', () => {
    it('should return DLX directory', () => {
      const result = getSocketDlxDir()
      expect(result).toContain('.socket/_dlx')
    })

    it('should return normalized path', () => {
      const result = getSocketDlxDir()
      expect(result).not.toContain('\\')
    })

    it('should be under Socket user directory', () => {
      const userDir = getSocketUserDir()
      const dlxDir = getSocketDlxDir()
      expect(dlxDir).toContain(userDir)
    })
  })

  describe('getSocketAppCacheDir', () => {
    it('should return app cache directory', () => {
      const result = getSocketAppCacheDir('myapp')
      expect(result).toContain('.socket/_myapp/cache')
    })

    it('should be under app directory', () => {
      const appDir = getSocketAppDir('test')
      const cacheDir = getSocketAppCacheDir('test')
      expect(cacheDir).toContain(appDir)
      expect(cacheDir).toMatch(/cache$/)
    })

    it('should return normalized path', () => {
      const result = getSocketAppCacheDir('test')
      expect(result).not.toContain('\\')
    })

    it('should work with different app names', () => {
      const cache1 = getSocketAppCacheDir('app1')
      const cache2 = getSocketAppCacheDir('app2')
      expect(cache1).toContain('_app1/cache')
      expect(cache2).toContain('_app2/cache')
      expect(cache1).not.toBe(cache2)
    })

    it('should handle empty app name', () => {
      const result = getSocketAppCacheDir('')
      expect(result).toContain('.socket/_/cache')
    })
  })

  describe('getSocketAppCacheTtlDir', () => {
    it('should return app TTL cache directory', () => {
      const result = getSocketAppCacheTtlDir('myapp')
      expect(result).toContain('.socket/_myapp/cache/ttl')
    })

    it('should be under app cache directory', () => {
      const cacheDir = getSocketAppCacheDir('test')
      const ttlDir = getSocketAppCacheTtlDir('test')
      expect(ttlDir).toContain(cacheDir)
      expect(ttlDir).toMatch(/ttl$/)
    })

    it('should return normalized path', () => {
      const result = getSocketAppCacheTtlDir('test')
      expect(result).not.toContain('\\')
    })

    it('should work with different app names', () => {
      const ttl1 = getSocketAppCacheTtlDir('app1')
      const ttl2 = getSocketAppCacheTtlDir('app2')
      expect(ttl1).toContain('_app1/cache/ttl')
      expect(ttl2).toContain('_app2/cache/ttl')
      expect(ttl1).not.toBe(ttl2)
    })

    it('should handle empty app name', () => {
      const result = getSocketAppCacheTtlDir('')
      expect(result).toContain('.socket/_/cache/ttl')
    })
  })

  describe('getSocketCliDir', () => {
    it('should return Socket CLI directory', () => {
      const result = getSocketCliDir()
      expect(result).toContain('.socket/_socket')
    })

    it('should be an app directory', () => {
      const cliDir = getSocketCliDir()
      const appDir = getSocketAppDir('socket')
      expect(cliDir).toBe(appDir)
    })

    it('should return normalized path', () => {
      const result = getSocketCliDir()
      expect(result).not.toContain('\\')
    })

    it('should be under Socket user directory', () => {
      const userDir = getSocketUserDir()
      const cliDir = getSocketCliDir()
      expect(cliDir).toContain(userDir)
    })
  })

  describe('getSocketRegistryDir', () => {
    it('should return Socket Registry directory', () => {
      const result = getSocketRegistryDir()
      expect(result).toContain('.socket/_registry')
    })

    it('should be an app directory', () => {
      const registryDir = getSocketRegistryDir()
      const appDir = getSocketAppDir('registry')
      expect(registryDir).toBe(appDir)
    })

    it('should return normalized path', () => {
      const result = getSocketRegistryDir()
      expect(result).not.toContain('\\')
    })

    it('should be under Socket user directory', () => {
      const userDir = getSocketUserDir()
      const registryDir = getSocketRegistryDir()
      expect(registryDir).toContain(userDir)
    })
  })

  describe('getSocketRegistryGithubCacheDir', () => {
    it('should return Socket Registry GitHub cache directory', () => {
      const result = getSocketRegistryGithubCacheDir()
      expect(result).toContain('.socket/_registry/cache/ttl/github')
    })

    it('should be under Registry TTL cache directory', () => {
      const ttlDir = getSocketAppCacheTtlDir('registry')
      const githubDir = getSocketRegistryGithubCacheDir()
      expect(githubDir).toContain(ttlDir)
      expect(githubDir).toMatch(/github$/)
    })

    it('should return normalized path', () => {
      const result = getSocketRegistryGithubCacheDir()
      expect(result).not.toContain('\\')
    })

    it('should be under Socket user directory', () => {
      const userDir = getSocketUserDir()
      const githubDir = getSocketRegistryGithubCacheDir()
      expect(githubDir).toContain(userDir)
    })
  })

  describe('path hierarchy', () => {
    it('should maintain correct directory hierarchy', () => {
      const userDir = getSocketUserDir()
      const appDir = getSocketAppDir('test')
      const cacheDir = getSocketAppCacheDir('test')
      const ttlDir = getSocketAppCacheTtlDir('test')

      // User dir should be the base
      expect(appDir).toContain(userDir)
      expect(cacheDir).toContain(userDir)
      expect(ttlDir).toContain(userDir)

      // Cache dir should be under app dir
      expect(cacheDir).toContain(appDir)

      // TTL dir should be under cache dir
      expect(ttlDir).toContain(cacheDir)
    })

    it('should have consistent path structure', () => {
      const paths = [
        getSocketUserDir(),
        getSocketAppDir('test'),
        getSocketCacacheDir(),
        getSocketDlxDir(),
        getSocketCliDir(),
        getSocketRegistryDir(),
        getSocketAppCacheDir('test'),
        getSocketAppCacheTtlDir('test'),
        getSocketRegistryGithubCacheDir(),
      ]

      // All paths should be non-empty strings
      paths.forEach(path => {
        expect(typeof path).toBe('string')
        expect(path.length).toBeGreaterThan(0)
      })

      // All paths should use forward slashes (normalized)
      paths.forEach(path => {
        expect(path).not.toContain('\\')
      })

      // All paths should contain .socket
      paths.forEach(path => {
        expect(path).toContain('.socket')
      })
    })

    it('should generate unique paths for different apps', () => {
      const app1Dir = getSocketAppDir('app1')
      const app2Dir = getSocketAppDir('app2')
      const app1Cache = getSocketAppCacheDir('app1')
      const app2Cache = getSocketAppCacheDir('app2')

      expect(app1Dir).not.toBe(app2Dir)
      expect(app1Cache).not.toBe(app2Cache)
    })
  })

  describe('cross-platform compatibility', () => {
    it('should handle home directory correctly on different platforms', () => {
      const userDir = getSocketUserDir()

      if (process.platform === 'win32') {
        // Windows paths should have drive letter and forward slashes after normalization
        expect(userDir).toMatch(/^[A-Za-z]:\//)
        expect(userDir).not.toContain('\\')
      } else {
        // Unix-like paths should start with /
        expect(userDir).toMatch(/^\//)
      }
    })

    it('should return absolute paths on all platforms', () => {
      const paths = [
        getSocketUserDir(),
        getSocketAppDir('test'),
        getSocketCacacheDir(),
        getSocketDlxDir(),
      ]

      paths.forEach(path => {
        if (process.platform === 'win32') {
          expect(path).toMatch(/^[A-Za-z]:\//)
        } else {
          expect(path).toMatch(/^\//)
        }
      })
    })

    it('should not contain backslashes in normalized paths', () => {
      const paths = [
        getSocketUserDir(),
        getSocketAppDir('test'),
        getSocketCacacheDir(),
        getSocketDlxDir(),
        getSocketAppCacheDir('test'),
        getSocketAppCacheTtlDir('test'),
      ]

      paths.forEach(path => {
        expect(path).not.toContain('\\')
      })
    })
  })

  describe('edge cases', () => {
    it('should handle app names with various characters', () => {
      const testCases = [
        'simple',
        'with-dash',
        'with.dot',
        'with_underscore',
        'MixedCase',
        '123numeric',
      ]

      testCases.forEach(appName => {
        const result = getSocketAppDir(appName)
        expect(result).toContain(`_${appName}`)
        expect(result).toContain('.socket')
      })
    })

    it('should handle empty string app name gracefully', () => {
      const result = getSocketAppDir('')
      expect(result).toContain('.socket/_')
      expect(typeof result).toBe('string')
    })

    it('should return consistent results on multiple calls', () => {
      const call1 = getSocketUserDir()
      const call2 = getSocketUserDir()
      const call3 = getSocketUserDir()

      expect(call1).toBe(call2)
      expect(call2).toBe(call3)
    })

    it('should return consistent results for same app name', () => {
      const call1 = getSocketAppDir('test')
      const call2 = getSocketAppDir('test')
      const call3 = getSocketAppDir('test')

      expect(call1).toBe(call2)
      expect(call2).toBe(call3)
    })
  })

  describe('specific app directories', () => {
    it('should generate correct CLI directory', () => {
      const cliDir = getSocketCliDir()
      expect(cliDir).toContain('_socket')
      expect(cliDir).toMatch(/\/_socket$/)
    })

    it('should generate correct Registry directory', () => {
      const registryDir = getSocketRegistryDir()
      expect(registryDir).toContain('_registry')
      expect(registryDir).toMatch(/\/_registry$/)
    })

    it('should generate correct DLX directory', () => {
      const dlxDir = getSocketDlxDir()
      expect(dlxDir).toContain('_dlx')
      expect(dlxDir).toMatch(/\/_dlx$/)
    })

    it('should generate correct cacache directory', () => {
      const cacacheDir = getSocketCacacheDir()
      expect(cacacheDir).toContain('_cacache')
      expect(cacacheDir).toMatch(/\/_cacache$/)
    })
  })
})
