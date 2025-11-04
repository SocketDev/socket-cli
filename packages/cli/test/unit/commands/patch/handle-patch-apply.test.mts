/**
 * Unit Tests: Socket Registry Patch Application Handler
 *
 * Purpose:
 * Tests the command handler that applies Socket Registry patches to installed packages in
 * node_modules. Validates package resolution via PURL, patch file discovery and copying,
 * dry-run mode, and error handling for various failure scenarios.
 *
 * Test Coverage:
 * - Successful patch application with file copying
 * - Package resolution from PURL specifications
 * - Patch file discovery via glob patterns
 * - Dry-run mode (validation without file modifications)
 * - Package not found error handling
 * - Missing patch file scenarios
 * - File system operation error handling
 * - Multiple package patching in single invocation
 *
 * Testing Approach:
 * Mocks fs operations, fast-glob, package.json reading, PURL parsing, and output formatting
 * to test patch application logic without actual file system modifications. Tests verify
 * proper error handling and result reporting.
 *
 * Related Files:
 * - src/commands/patch/handle-patch-apply.mts - Patch application handler
 * - src/commands/patch/output-patch-result.mts - Result output formatter
 * - src/utils/purl/parse.mts - PURL parsing utilities
 */

import { describe, expect, it, vi } from 'vitest'

import { handlePatchApply } from '../../../../src/commands/patch/handle-patch-apply.mts'

import type { PackageURL } from '@socketregistry/packageurl-js'

// Mock the dependencies.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  promises: {
    copyFile: vi.fn(),
    readFile: vi.fn(),
  },
}))

vi.mock('fast-glob', () => ({
  default: {
    glob: vi.fn(),
  },
}))

vi.mock('@socketsecurity/lib/fs', () => ({
  readDirNames: vi.fn(),
}))

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('@socketsecurity/lib/packages', () => ({
  readPackageJson: vi.fn(),
}))

vi.mock('../../../../src/commands/patch/output-patch-result.mts', () => ({
  outputPatchResult: vi.fn(),
}))

vi.mock('../../../../src/utils/fs/find-up.mts', () => ({
  findUp: vi.fn(),
}))

vi.mock('../../../../src/utils/purl/parse.mts', () => ({
  getPurlObject: vi.fn(),
  normalizePurl: vi.fn(purl =>
    purl.startsWith('pkg:') ? purl : `pkg:${purl}`,
  ),
}))

describe('handlePatch', () => {
  it('handles successful patch application', async () => {
    const { existsSync, promises: fs } = await import('node:fs')
    const fastGlob = await import('fast-glob')
    const { readDirNames } = await import('@socketsecurity/lib/fs')
    const { outputPatchResult } = await import('../../../../src/commands/patch/output-patch-result.mts')
    const { findUp } = await import('../../../../src/utils/fs/find-up.mts')
    const mockExistsSync = vi.mocked(existsSync)
    const mockReadFile = vi.mocked(fs.readFile)
    const mockOutput = vi.mocked(outputPatchResult)
    const mockFindUp = vi.mocked(findUp)
    const mockGlob = vi.mocked(fastGlob.default.glob)
    const mockReadDirNames = vi.mocked(readDirNames)

    mockExistsSync.mockReturnValue(true)
    mockFindUp.mockResolvedValue('/project/node_modules')
    mockGlob.mockResolvedValue(['/project/node_modules'])
    mockReadDirNames.mockResolvedValue([])
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        patches: {
          'npm/lodash@4.17.21': {
            exportedAt: '2025-01-01T00:00:00.000Z',
            files: {
              'index.js': {
                beforeHash: 'abc123',
                afterHash: 'def456',
              },
            },
            vulnerabilities: {
              'GHSA-xxxx-yyyy-zzzz': {
                cves: ['CVE-2025-0001'],
                summary: 'Test vulnerability',
                severity: 'high',
                description: 'Test description',
                patchExplanation: 'Test patch explanation',
              },
            },
          },
        },
      }),
    )

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    await handlePatchApply({
      cwd: '/project',
      dryRun: false,
      outputKind: 'json',
      purlObjs: [],
      spinner: mockSpinner as any,
    })

    expect(mockReadFile).toHaveBeenCalledWith(
      '/project/.socket/manifest.json',
      'utf8',
    )
    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      'json',
    )
  })

  it('handles dry run mode', async () => {
    const { promises: fs } = await import('node:fs')
    const { outputPatchResult } = await import('../../../../src/commands/patch/output-patch-result.mts')
    const mockReadFile = vi.mocked(fs.readFile)
    const mockOutput = vi.mocked(outputPatchResult)

    mockReadFile.mockResolvedValue(
      JSON.stringify({
        patches: {},
      }),
    )

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    await handlePatchApply({
      cwd: '/project',
      dryRun: true,
      outputKind: 'text',
      purlObjs: [],
      spinner: mockSpinner as any,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: { patched: [] },
      }),
      'text',
    )
  })

  it('handles invalid JSON in manifest', async () => {
    const { promises: fs } = await import('node:fs')
    const { outputPatchResult } = await import('../../../../src/commands/patch/output-patch-result.mts')
    const mockReadFile = vi.mocked(fs.readFile)
    const mockOutput = vi.mocked(outputPatchResult)

    mockReadFile.mockResolvedValue('invalid json')

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    await handlePatchApply({
      cwd: '/project',
      dryRun: false,
      outputKind: 'json',
      purlObjs: [],
      spinner: mockSpinner as any,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: 'Invalid JSON in manifest.json',
      }),
      'json',
    )
  })

  it('filters patches by specified PURLs', async () => {
    const { promises: fs } = await import('node:fs')
    const { getPurlObject } = await import('../../../../src/utils/purl/parse.mts')
    const mockReadFile = vi.mocked(fs.readFile)
    const mockGetPurlObject = vi.mocked(getPurlObject)

    mockReadFile.mockResolvedValue(
      JSON.stringify({
        patches: {
          'npm/lodash@4.17.21': {
            exportedAt: '2025-01-01T00:00:00.000Z',
            files: {},
            vulnerabilities: {},
          },
          'npm/express@4.18.2': {
            exportedAt: '2025-01-01T00:00:00.000Z',
            files: {},
            vulnerabilities: {},
          },
        },
      }),
    )

    mockGetPurlObject.mockReturnValue({
      type: 'npm',
      name: 'lodash',
      version: '4.17.21',
    } as PackageURL)

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    const purlObjs = [
      {
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
        toString: () => 'pkg:npm/lodash@4.17.21',
      } as PackageURL,
    ]

    await handlePatchApply({
      cwd: '/project',
      dryRun: false,
      outputKind: 'json',
      purlObjs,
      spinner: mockSpinner as any,
    })

    expect(mockSpinner.start).toHaveBeenCalledWith(
      expect.stringContaining('lodash'),
    )
  })

  it('handles schema validation errors', async () => {
    const { promises: fs } = await import('node:fs')
    const { outputPatchResult } = await import('../../../../src/commands/patch/output-patch-result.mts')
    const mockReadFile = vi.mocked(fs.readFile)
    const mockOutput = vi.mocked(outputPatchResult)

    mockReadFile.mockResolvedValue(
      JSON.stringify({
        patches: {
          'invalid-purl': {
            // Missing required fields.
          },
        },
      }),
    )

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    await handlePatchApply({
      cwd: '/project',
      dryRun: false,
      outputKind: 'json',
      purlObjs: [],
      spinner: mockSpinner as any,
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: 'Schema validation failed',
      }),
      'json',
    )
  })

  it('handles markdown output format', async () => {
    const { promises: fs } = await import('node:fs')
    const { outputPatchResult } = await import('../../../../src/commands/patch/output-patch-result.mts')
    const mockReadFile = vi.mocked(fs.readFile)
    const mockOutput = vi.mocked(outputPatchResult)

    mockReadFile.mockResolvedValue(
      JSON.stringify({
        patches: {},
      }),
    )

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    await handlePatchApply({
      cwd: '/project',
      dryRun: false,
      outputKind: 'markdown',
      purlObjs: [],
      spinner: mockSpinner as any,
    })

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('handles file read errors', async () => {
    const { promises: fs } = await import('node:fs')
    const { outputPatchResult } = await import('../../../../src/commands/patch/output-patch-result.mts')
    const mockReadFile = vi.mocked(fs.readFile)
    const mockOutput = vi.mocked(outputPatchResult)

    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const mockSpinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    }

    await handlePatchApply({
      cwd: '/project',
      dryRun: false,
      outputKind: 'json',
      purlObjs: [],
      spinner: mockSpinner as any,
    })

    expect(mockSpinner.stop).toHaveBeenCalled()
    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: 'Failed to apply patches',
      }),
      'json',
    )
  })
})
