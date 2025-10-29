/**
 * Unit tests for self-update command.
 *
 * These tests validate the full self-update flow including:
 * - Version checking from npm registry
 * - Package download and extraction
 * - Integrity verification
 * - Binary replacement with rollback
 * - Stub update logic
 * - Error handling
 * - Flag behavior (dry-run, force)
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NpmPackageMetadata } from '../../utils/registry/npm-registry.mts'

// Mock external dependencies.
vi.mock('../../utils/registry/npm-registry.mts', () => ({
  downloadTarball: vi.fn(),
  extractBinaryFromTarball: vi.fn(),
  fetchPackageMetadata: vi.fn(),
  verifyTarballIntegrity: vi.fn(),
}))

vi.mock('@socketsecurity/lib/ipc', () => ({
  getIpcStubPath: vi.fn(),
}))

vi.mock('../../utils/executable/detect.mjs', () => ({
  isSeaBinary: vi.fn(() => true),
}))

vi.mock('../../utils/process/os.mjs', () => ({
  clearQuarantine: vi.fn().mockResolvedValue(undefined),
  ensureExecutable: vi.fn().mockResolvedValue(undefined),
  getBinaryRelativePath: vi.fn(() => 'bin/socket'),
  getSocketbinPackageName: vi.fn(() => '@socketbin/cli-darwin-arm64'),
}))

vi.mock('../../constants/env.mts', () => ({
  default: {
    INLINED_SOCKET_CLI_VERSION: '1.0.0',
  },
  getCliVersion: vi.fn(() => '1.0.0'),
  getCliVersionHash: vi.fn(() => undefined),
  getCliHomepage: vi.fn(() => undefined),
  getCliName: vi.fn(() => 'socket'),
  isPublishedBuild: vi.fn(() => false),
  isLegacyBuild: vi.fn(() => false),
  isSentryBuild: vi.fn(() => false),
  getCoanaVersion: vi.fn(() => undefined),
  getCdxgenVersion: vi.fn(() => undefined),
  getSynpVersion: vi.fn(() => undefined),
  getPythonVersion: vi.fn(() => undefined),
  getPythonBuildTag: vi.fn(() => undefined),
}))

// Import after mocks.
import {
  downloadTarball,
  extractBinaryFromTarball,
  fetchPackageMetadata,
  verifyTarballIntegrity,
} from '../../utils/registry/npm-registry.mts'

import { getIpcStubPath } from '@socketsecurity/lib/ipc'

import { isSeaBinary } from '../../utils/executable/detect.mjs'
import { clearQuarantine, ensureExecutable } from '../../utils/process/os.mjs'
import { handleSelfUpdate } from './handle-self-update.mts'

// Helper to create mock package metadata.
function createMockMetadata(version: string): NpmPackageMetadata {
  return {
    name: '@socketbin/cli-darwin-arm64',
    version,
    dist: {
      tarball: `https://registry.npmjs.org/@socketbin/cli-darwin-arm64/-/cli-darwin-arm64-${version}.tgz`,
      integrity: 'sha512-mockintegrityhash==',
    },
  }
}

describe('handleSelfUpdate', () => {
  let tempDir: string
  let testBinaryPath: string

  beforeEach(async () => {
    // Create temp directory for test binary.
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'self-update-test-'))
    testBinaryPath = path.join(tempDir, 'socket')

    // Create a fake binary file.
    await fs.writeFile(
      testBinaryPath,
      '#!/usr/bin/env node\nconsole.log("test")',
    )
    await fs.chmod(testBinaryPath, 0o755)

    // Mock process.argv[0] to point to our test binary.
    vi.spyOn(process, 'argv', 'get').mockReturnValue([
      testBinaryPath,
      'self-update',
    ])

    // Mock process.platform and process.arch.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')

    // Reset all mocks.
    vi.clearAllMocks()

    // Default mock implementations.
    vi.mocked(isSeaBinary).mockReturnValue(true)
    vi.mocked(getIpcStubPath).mockReturnValue(null)
    vi.mocked(verifyTarballIntegrity).mockResolvedValue(true)
    vi.mocked(clearQuarantine).mockResolvedValue(undefined)
    vi.mocked(ensureExecutable).mockResolvedValue(undefined)

    // Mock extractBinaryFromTarball to actually create the file.
    vi.mocked(extractBinaryFromTarball).mockImplementation(
      async (_tarballPath, _binaryRelativePath, destination) => {
        await fs.writeFile(
          destination,
          '#!/usr/bin/env node\nconsole.log("new")',
        )
        await fs.chmod(destination, 0o755)
        return destination
      },
    )
  })

  afterEach(async () => {
    // Clean up temp directory.
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('prerequisite checks', () => {
    it('should throw error when not running as SEA binary', async () => {
      vi.mocked(isSeaBinary).mockReturnValue(false)

      await expect(
        handleSelfUpdate([], import.meta, { parentName: 'socket' }),
      ).rejects.toThrow(
        'self-update is only available when running as a SEA binary',
      )
    })

    it('should throw error when current binary path not found', async () => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue([
        '/nonexistent/binary',
        'self-update',
      ])

      await expect(
        handleSelfUpdate([], import.meta, { parentName: 'socket' }),
      ).rejects.toThrow('Current binary not found at /nonexistent/binary')
    })
  })

  describe('version comparison', () => {
    it('should skip update when already on latest version', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.0.0'),
      )

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(fetchPackageMetadata).toHaveBeenCalledWith(
        '@socketbin/cli-darwin-arm64',
        'latest',
      )
      expect(downloadTarball).not.toHaveBeenCalled()
    })

    it('should update when newer version available', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(fetchPackageMetadata).toHaveBeenCalledWith(
        '@socketbin/cli-darwin-arm64',
        'latest',
      )
      expect(downloadTarball).toHaveBeenCalled()
      expect(extractBinaryFromTarball).toHaveBeenCalled()
      expect(verifyTarballIntegrity).toHaveBeenCalled()
    })

    it('should force update even when on latest version with --force flag', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.0.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate(['--force'], import.meta, { parentName: 'socket' })

      expect(downloadTarball).toHaveBeenCalled()
    })
  })

  describe('dry-run mode', () => {
    it('should check for updates without downloading with --dry-run flag', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )

      await handleSelfUpdate(['--dry-run'], import.meta, {
        parentName: 'socket',
      })

      expect(fetchPackageMetadata).toHaveBeenCalled()
      expect(downloadTarball).not.toHaveBeenCalled()
    })

    it('should not modify any files in dry-run mode', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )

      const originalContent = await fs.readFile(testBinaryPath, 'utf8')

      await handleSelfUpdate(['--dry-run'], import.meta, {
        parentName: 'socket',
      })

      const afterContent = await fs.readFile(testBinaryPath, 'utf8')
      expect(afterContent).toBe(originalContent)
    })
  })

  describe('successful update flow', () => {
    it('should fetch latest version from npm registry', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(fetchPackageMetadata).toHaveBeenCalledWith(
        '@socketbin/cli-darwin-arm64',
        'latest',
      )
    })

    it('should download package tarball from npm registry', async () => {
      const metadata = createMockMetadata('1.1.0')
      vi.mocked(fetchPackageMetadata).mockResolvedValue(metadata)
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(downloadTarball).toHaveBeenCalledWith(
        metadata.dist.tarball,
        expect.stringContaining('package.tgz'),
      )
    })

    it('should verify package integrity using npm metadata', async () => {
      const metadata = createMockMetadata('1.1.0')
      vi.mocked(fetchPackageMetadata).mockResolvedValue(metadata)
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(verifyTarballIntegrity).toHaveBeenCalledWith(
        expect.stringContaining('package.tgz'),
        metadata.dist.integrity,
      )
    })

    it('should extract binary from tarball', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(extractBinaryFromTarball).toHaveBeenCalledWith(
        expect.stringContaining('package.tgz'),
        'bin/socket',
        expect.stringContaining('socket-binary'),
      )
    })

    it('should create backup of current binary', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      // Check that backup file was created.
      const backupFiles = (await fs.readdir(tempDir)).filter(f =>
        f.includes('backup'),
      )
      expect(backupFiles.length).toBeGreaterThan(0)
    })

    it('should set executable permissions on new binary', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(ensureExecutable).toHaveBeenCalled()
    })

    it('should clear quarantine on macOS', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(clearQuarantine).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should throw error when package metadata is invalid', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue({
        name: '@socketbin/cli-darwin-arm64',
        version: '1.1.0',
        dist: {} as never,
      })

      await expect(
        handleSelfUpdate([], import.meta, { parentName: 'socket' }),
      ).rejects.toThrow('Invalid package metadata from npm registry')
    })

    it('should throw error when integrity verification fails', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)
      vi.mocked(verifyTarballIntegrity).mockResolvedValue(false)

      await expect(
        handleSelfUpdate([], import.meta, { parentName: 'socket' }),
      ).rejects.toThrow('Package integrity verification failed')
    })

    it('should restore from backup on binary replacement failure', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      // Mock ensureExecutable to fail.
      vi.mocked(ensureExecutable).mockRejectedValue(
        new Error('Permission denied'),
      )

      const originalContent = await fs.readFile(testBinaryPath, 'utf8')

      await expect(
        handleSelfUpdate([], import.meta, { parentName: 'socket' }),
      ).rejects.toThrow()

      // Verify original binary was restored.
      const restoredContent = await fs.readFile(testBinaryPath, 'utf8')
      expect(restoredContent).toBe(originalContent)
    })
  })

  describe('stub update', () => {
    it('should check for stub updates when launched via bootstrap', async () => {
      // Mock stub path.
      const stubPath = path.join(tempDir, 'socket-stub')
      await fs.writeFile(stubPath, '#!/usr/bin/env node\nconsole.log("stub")')
      await fs.chmod(stubPath, 0o755)
      vi.mocked(getIpcStubPath).mockReturnValue(stubPath)

      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.0.0'),
      )

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(getIpcStubPath).toHaveBeenCalledWith('socket-cli')
    })

    it('should skip stub update when not launched via bootstrap', async () => {
      vi.mocked(getIpcStubPath).mockReturnValue(null)
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.0.0'),
      )

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      expect(getIpcStubPath).toHaveBeenCalledWith('socket-cli')
      // No stub update should occur.
    })
  })

  describe('cleanup', () => {
    it('should clean up temporary files after successful update', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockResolvedValue(undefined)

      await handleSelfUpdate([], import.meta, { parentName: 'socket' })

      // Check that temp update directory was cleaned up.
      const tempDirs = (await fs.readdir(os.tmpdir())).filter(f =>
        f.startsWith('socket-update-'),
      )
      expect(tempDirs.length).toBe(0)
    })

    it('should clean up temporary files after failed update', async () => {
      vi.mocked(fetchPackageMetadata).mockResolvedValue(
        createMockMetadata('1.1.0'),
      )
      vi.mocked(downloadTarball).mockRejectedValue(new Error('Network error'))

      await expect(
        handleSelfUpdate([], import.meta, { parentName: 'socket' }),
      ).rejects.toThrow()

      // Check that temp update directory was cleaned up.
      const tempDirs = (await fs.readdir(os.tmpdir())).filter(f =>
        f.startsWith('socket-update-'),
      )
      expect(tempDirs.length).toBe(0)
    })
  })
})
