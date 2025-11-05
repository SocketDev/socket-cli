/**
 * Unit tests for CI command handler.
 *
 * Tests the main CI command that orchestrates repository scanning in CI/CD environments.
 * This is a complex handler integrating organization detection, branch detection, and scan creation.
 *
 * Test Coverage:
 * - Successful CI scan creation with full workflow
 * - Organization slug detection (config, env, API fallback)
 * - Repository name detection from Git
 * - Default branch detection
 * - Current branch detection (Git)
 * - Scan creation with proper parameters
 * - Error handling for missing organization
 * - Error handling for Git detection failures
 * - Debug logging integration
 * - JSON result serialization
 *
 * Testing Approach:
 * - Mock getDefaultOrgSlug for organization detection
 * - Mock detectDefaultBranch and gitBranch for Git operations
 * - Mock getRepoName for repository detection
 * - Mock handleCreateNewScan for scan creation
 * - Mock logger for output verification
 * - Mock debug utilities for debug logging
 * - Test complete workflow integration
 *
 * Related Files:
 * - src/commands/ci/handle-ci.mts - Implementation
 * - src/commands/ci/fetch-default-org-slug.mts - Org detection
 * - src/commands/scan/handle-create-new-scan.mts - Scan creation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCi } from '../../../../src/commands/ci/handle-ci.mts'
import { UNKNOWN_ERROR } from '../../../../src/constants/errors.mts'

// Create mock functions with hoisting.
const {
  mockDebug,
  mockDebugDir,
  mockDetectDefaultBranch,
  mockGetDefaultOrgSlug,
  mockGetRepoName,
  mockGitBranch,
  mockHandleCreateNewScan,
  mockLogger,
  mockSerializeResultJson,
} = vi.hoisted(() => {
  const logger = {
    fail: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  return {
    mockDebug: vi.fn(),
    mockDebugDir: vi.fn(),
    mockGetDefaultOrgSlug: vi.fn(),
    mockDetectDefaultBranch: vi.fn(),
    mockGetRepoName: vi.fn(),
    mockGitBranch: vi.fn(),
    mockSerializeResultJson: vi.fn(result => JSON.stringify(result)),
    mockHandleCreateNewScan: vi.fn(),
    mockLogger: logger,
  }
})

// Mock the dependencies.
const mockDebugLog = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
  debugLog: mockDebugLog,
  isDebug: mockIsDebug,
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: mockGetDefaultOrgSlug,
}))

vi.mock('../../../../src/constants.mts', () => ({
  default: {
    REPORT_LEVEL_ERROR: 'error',
  },
}))

vi.mock('../../../../src/utils/git/operations.mjs', () => ({
  detectDefaultBranch: mockDetectDefaultBranch,
  getRepoName: mockGetRepoName,
  gitBranch: mockGitBranch,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: mockSerializeResultJson,
}))

vi.mock('../../../../src/commands/scan/handle-create-new-scan.mts', () => ({
  handleCreateNewScan: mockHandleCreateNewScan,
}))

describe('handleCi', () => {
  const originalCwd = process.cwd
  const originalExitCode = process.exitCode
  const logger = mockLogger

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn(() => '/test/project')
    process.exitCode = undefined
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.exitCode = originalExitCode
  })

  it('handles CI scan successfully', async () => {
    mockGetDefaultOrgSlug.mockResolvedValue({
      ok: true,
      data: 'test-org',
    })
    mockGitBranch.mockResolvedValue('feature-branch')
    mockGetRepoName.mockResolvedValue('test-repo')

    await handleCi(false)

    expect(mockGetDefaultOrgSlug).toHaveBeenCalled()
    expect(mockGitBranch).toHaveBeenCalledWith('/test/project')
    expect(mockGetRepoName).toHaveBeenCalledWith('/test/project')
    expect(mockDetectDefaultBranch).not.toHaveBeenCalled()
    expect(mockHandleCreateNewScan).toHaveBeenCalledWith({
      autoManifest: false,
      branchName: 'feature-branch',
      commitMessage: '',
      commitHash: '',
      committers: '',
      cwd: '/test/project',
      defaultBranch: false,
      interactive: false,
      orgSlug: 'test-org',
      outputKind: 'json',
      pendingHead: true,
      pullRequest: 0,
      reach: expect.objectContaining({
        runReachabilityAnalysis: false,
      }),
      repoName: 'test-repo',
      readOnly: false,
      report: true,
      reportLevel: 'error',
      targets: ['.'],
      tmp: false,
    })
  })

  it('uses default branch when git branch is not available', async () => {
    mockGetDefaultOrgSlug.mockResolvedValue({
      ok: true,
      data: 'test-org',
    })
    mockGitBranch.mockResolvedValue(null)
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockGetRepoName.mockResolvedValue('test-repo')

    await handleCi(false)

    expect(mockGitBranch).toHaveBeenCalled()
    expect(mockDetectDefaultBranch).toHaveBeenCalledWith('/test/project')
    expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
      expect.objectContaining({
        branchName: 'main',
      }),
    )
  })

  it('handles auto-manifest mode', async () => {
    mockGetDefaultOrgSlug.mockResolvedValue({
      ok: true,
      data: 'test-org',
    })
    mockGitBranch.mockResolvedValue('develop')
    mockGetRepoName.mockResolvedValue('test-repo')

    await handleCi(true)

    expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
      expect.objectContaining({
        autoManifest: true,
      }),
    )
  })

  it('handles org slug fetch failure', async () => {
    const error = {
      ok: false as const,
      code: 401,
      error: {},
    }
    mockGetDefaultOrgSlug.mockResolvedValue(error)

    await handleCi(false)

    expect(process.exitCode).toBe(401)
    expect(mockSerializeResultJson).toHaveBeenCalledWith(error)
    expect(logger.log).toHaveBeenCalledWith(JSON.stringify(error))
    expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
  })

  it('sets default exit code on org slug failure without code', async () => {
    const error = {
      ok: false as const,
      error: new Error(UNKNOWN_ERROR),
    }
    mockGetDefaultOrgSlug.mockResolvedValue(error)
    mockSerializeResultJson.mockReturnValue('{"error":"Unknown error"}')

    await handleCi(false)

    expect(process.exitCode).toBe(1)
    expect(logger.log).toHaveBeenCalled()
  })

  it('logs debug information', async () => {
    mockGetDefaultOrgSlug.mockResolvedValue({
      ok: true,
      data: 'debug-org',
    })
    mockGitBranch.mockResolvedValue('debug-branch')
    mockGetRepoName.mockResolvedValue('debug-repo')

    await handleCi(false)

    expect(mockDebug).toHaveBeenCalledWith('Starting CI scan')
    expect(mockDebugDir).toHaveBeenCalledWith({ autoManifest: false })
    expect(mockDebug).toHaveBeenCalledWith(
      'CI scan for debug-org/debug-repo on branch debug-branch',
    )
    expect(mockDebugDir).toHaveBeenCalledWith({
      orgSlug: 'debug-org',
      cwd: '/test/project',
      branchName: 'debug-branch',
      repoName: 'debug-repo',
    })
  })

  it('logs debug info on org slug failure', async () => {
    const error = {
      ok: false as const,
      error: new Error('Failed'),
    }
    mockGetDefaultOrgSlug.mockResolvedValue(error)

    await handleCi(false)

    expect(mockDebug).toHaveBeenCalledWith('Failed to get default org slug')
    expect(mockDebugDir).toHaveBeenCalledWith({ orgSlugCResult: error })
  })
})
