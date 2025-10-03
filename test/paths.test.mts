import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getSocketCliBaseDir,
  getSocketCliCacheDir,
  getSocketCliCacheTtlDir,
  getSocketCliCliDir,
  getSocketCliGithubCacheDir,
  getSocketCliSeaDir,
  getSocketCliSocketApiCacheDir,
  getSocketCliTmpDir,
  getSocketCliUpdaterBackupsDir,
  getSocketCliUpdaterDir,
  getSocketCliUpdaterDownloadsDir,
  getSocketCliUpdaterStagingDir,
  getSocketCliUpdaterStateJsonPath,
} from '../src/utils/paths.mts'

describe('paths module', () => {
  describe('getSocketCliBaseDir', () => {
    it('should return CLI base directory', () => {
      const result = getSocketCliBaseDir()
      expect(result).toBe(path.join(os.homedir(), '.socket', '_socket'))
    })

    it('should return consistent path on multiple calls', () => {
      const first = getSocketCliBaseDir()
      const second = getSocketCliBaseDir()
      expect(first).toBe(second)
    })
  })

  describe('getSocketCliCacheDir', () => {
    it('should return CLI cache directory', () => {
      const result = getSocketCliCacheDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'cache'),
      )
    })
  })

  describe('getSocketCliCacheTtlDir', () => {
    it('should return CLI TTL cache directory', () => {
      const result = getSocketCliCacheTtlDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'cache', 'ttl'),
      )
    })
  })

  describe('getSocketCliGithubCacheDir', () => {
    it('should return CLI GitHub cache directory', () => {
      const result = getSocketCliGithubCacheDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'cache', 'ttl', 'github'),
      )
    })
  })

  describe('getSocketCliSocketApiCacheDir', () => {
    it('should return CLI Socket API cache directory', () => {
      const result = getSocketCliSocketApiCacheDir()
      expect(result).toBe(
        path.join(
          os.homedir(),
          '.socket',
          '_socket',
          'cache',
          'ttl',
          'socket-api',
        ),
      )
    })
  })

  describe('getSocketCliCliDir', () => {
    it('should return CLI-specific directory', () => {
      const result = getSocketCliCliDir()
      expect(result).toBe(path.join(os.homedir(), '.socket', '_socket', 'cli'))
    })
  })

  describe('getSocketCliSeaDir', () => {
    it('should return CLI SEA directory', () => {
      const result = getSocketCliSeaDir()
      expect(result).toBe(path.join(os.homedir(), '.socket', '_socket', 'sea'))
    })
  })

  describe('getSocketCliTmpDir', () => {
    it('should return CLI temporary directory', () => {
      const result = getSocketCliTmpDir()
      expect(result).toBe(path.join(os.homedir(), '.socket', '_socket', 'tmp'))
    })
  })

  describe('getSocketCliUpdaterDir', () => {
    it('should return CLI updater directory', () => {
      const result = getSocketCliUpdaterDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'updater'),
      )
    })
  })

  describe('getSocketCliUpdaterDownloadsDir', () => {
    it('should return CLI updater downloads directory', () => {
      const result = getSocketCliUpdaterDownloadsDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'updater', 'downloads'),
      )
    })
  })

  describe('getSocketCliUpdaterBackupsDir', () => {
    it('should return CLI updater backups directory', () => {
      const result = getSocketCliUpdaterBackupsDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'updater', 'backups'),
      )
    })
  })

  describe('getSocketCliUpdaterStagingDir', () => {
    it('should return CLI updater staging directory', () => {
      const result = getSocketCliUpdaterStagingDir()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'updater', 'staging'),
      )
    })
  })

  describe('getSocketCliUpdaterStateJsonPath', () => {
    it('should return CLI updater state JSON path', () => {
      const result = getSocketCliUpdaterStateJsonPath()
      expect(result).toBe(
        path.join(os.homedir(), '.socket', '_socket', 'updater', 'state.json'),
      )
    })

    it('should end with state.json', () => {
      const result = getSocketCliUpdaterStateJsonPath()
      expect(result.endsWith('state.json')).toBe(true)
    })
  })

  describe('path consistency', () => {
    it('should have all directories under base dir', () => {
      const baseDir = getSocketCliBaseDir()
      const dirs = [
        getSocketCliCacheDir(),
        getSocketCliCliDir(),
        getSocketCliSeaDir(),
        getSocketCliTmpDir(),
        getSocketCliUpdaterDir(),
      ]
      for (const dir of dirs) {
        expect(dir.startsWith(baseDir)).toBe(true)
      }
    })

    it('should have cache dirs under cache dir', () => {
      const cacheDir = getSocketCliCacheDir()
      const cacheDirs = [
        getSocketCliCacheTtlDir(),
        getSocketCliGithubCacheDir(),
        getSocketCliSocketApiCacheDir(),
      ]
      for (const dir of cacheDirs) {
        expect(dir.startsWith(cacheDir)).toBe(true)
      }
    })

    it('should have TTL cache dirs under TTL dir', () => {
      const ttlDir = getSocketCliCacheTtlDir()
      const ttlDirs = [
        getSocketCliGithubCacheDir(),
        getSocketCliSocketApiCacheDir(),
      ]
      for (const dir of ttlDirs) {
        expect(dir.startsWith(ttlDir)).toBe(true)
      }
    })

    it('should have updater subdirs under updater dir', () => {
      const updaterDir = getSocketCliUpdaterDir()
      const updaterDirs = [
        getSocketCliUpdaterDownloadsDir(),
        getSocketCliUpdaterBackupsDir(),
        getSocketCliUpdaterStagingDir(),
      ]
      for (const dir of updaterDirs) {
        expect(dir.startsWith(updaterDir)).toBe(true)
      }
    })

    it('should have state.json under updater dir', () => {
      const updaterDir = getSocketCliUpdaterDir()
      const stateJsonPath = getSocketCliUpdaterStateJsonPath()
      expect(stateJsonPath.startsWith(updaterDir)).toBe(true)
    })
  })

  describe('platform compatibility', () => {
    it('should use correct path separators', () => {
      const result = getSocketCliBaseDir()
      expect(result.includes(path.sep)).toBe(true)
    })

    it('should not contain hardcoded slashes', () => {
      const result = getSocketCliBaseDir()
      const parts = result.split(path.sep)
      expect(parts[parts.length - 1]).toBe('_socket')
    })

    it('should handle paths consistently across functions', () => {
      const baseDir = getSocketCliBaseDir()
      const cacheDir = getSocketCliCacheDir()
      const relativePath = path.relative(baseDir, cacheDir)
      expect(relativePath).toBe('cache')
    })
  })

  describe('updater paths', () => {
    it('should have three separate updater subdirectories', () => {
      const downloads = getSocketCliUpdaterDownloadsDir()
      const backups = getSocketCliUpdaterBackupsDir()
      const staging = getSocketCliUpdaterStagingDir()

      expect(downloads).not.toBe(backups)
      expect(downloads).not.toBe(staging)
      expect(backups).not.toBe(staging)
    })

    it('should have state.json at updater root level', () => {
      const updaterDir = getSocketCliUpdaterDir()
      const stateJsonPath = getSocketCliUpdaterStateJsonPath()
      const relativePath = path.relative(updaterDir, stateJsonPath)
      expect(relativePath).toBe('state.json')
    })
  })
})
