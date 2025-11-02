import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCi } from './handle-ci.mts'
import { UNKNOWN_ERROR } from '../../constants/errors.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugLog: vi.fn(),
  isDebug: vi.fn(() => false),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    log: vi.fn(),
  },
}))
vi.mock('./fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: vi.fn(),
}))
vi.mock('../../constants.mts', () => ({
  default: {
    REPORT_LEVEL_ERROR: 'error',
  },
}))
vi.mock('../../utils/git/operations.mjs', () => ({
  detectDefaultBranch: vi.fn(),
  getRepoName: vi.fn(),
  gitBranch: vi.fn(),
}))
vi.mock('../../utils/output/result-json.mjs', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))
vi.mock('../scan/handle-create-new-scan.mts', () => ({
  handleCreateNewScan: vi.fn(),
}))

describe('handleCi', () => {
  const originalCwd = process.cwd
  const originalExitCode = process.exitCode

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
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')
    const { detectDefaultBranch, getRepoName, gitBranch } = await import(
      '../../utils/git/operations.mjs'
    )
    const { handleCreateNewScan } = await import(
      '../scan/handle-create-new-scan.mts'
    )

    vi.mocked(getDefaultOrgSlug).mockResolvedValue({
      ok: true,
      data: 'test-org',
    })
    vi.mocked(gitBranch).mockResolvedValue('feature-branch')
    vi.mocked(getRepoName).mockResolvedValue('test-repo')

    await handleCi(false)

    expect(getDefaultOrgSlug).toHaveBeenCalled()
    expect(gitBranch).toHaveBeenCalledWith('/test/project')
    expect(getRepoName).toHaveBeenCalledWith('/test/project')
    expect(detectDefaultBranch).not.toHaveBeenCalled()
    expect(handleCreateNewScan).toHaveBeenCalledWith({
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
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')
    const { detectDefaultBranch, getRepoName, gitBranch } = await import(
      '../../utils/git/operations.mjs'
    )
    const { handleCreateNewScan } = await import(
      '../scan/handle-create-new-scan.mts'
    )

    vi.mocked(getDefaultOrgSlug).mockResolvedValue({
      ok: true,
      data: 'test-org',
    })
    vi.mocked(gitBranch).mockResolvedValue(null)
    vi.mocked(detectDefaultBranch).mockResolvedValue('main')
    vi.mocked(getRepoName).mockResolvedValue('test-repo')

    await handleCi(false)

    expect(gitBranch).toHaveBeenCalled()
    expect(detectDefaultBranch).toHaveBeenCalledWith('/test/project')
    expect(handleCreateNewScan).toHaveBeenCalledWith(
      expect.objectContaining({
        branchName: 'main',
      }),
    )
  })

  it('handles auto-manifest mode', async () => {
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')
    const { getRepoName, gitBranch } = await import(
      '../../utils/git/operations.mjs'
    )
    const { handleCreateNewScan } = await import(
      '../scan/handle-create-new-scan.mts'
    )

    vi.mocked(getDefaultOrgSlug).mockResolvedValue({
      ok: true,
      data: 'test-org',
    })
    vi.mocked(gitBranch).mockResolvedValue('develop')
    vi.mocked(getRepoName).mockResolvedValue('test-repo')

    await handleCi(true)

    expect(handleCreateNewScan).toHaveBeenCalledWith(
      expect.objectContaining({
        autoManifest: true,
      }),
    )
  })

  it('handles org slug fetch failure', async () => {
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')
    const { serializeResultJson } = await import(
      '../../utils/output/result-json.mjs'
    )
    const { handleCreateNewScan } = await import(
      '../scan/handle-create-new-scan.mts'
    )

    const error = {
      ok: false as const,
      code: 401,
      error: {},
    }
    vi.mocked(getDefaultOrgSlug).mockResolvedValue(error)

    await handleCi(false)

    expect(process.exitCode).toBe(401)
    expect(serializeResultJson).toHaveBeenCalledWith(error)
    expect(getDefaultLogger().log).toHaveBeenCalledWith(JSON.stringify(error))
    expect(handleCreateNewScan).not.toHaveBeenCalled()
  })

  it('sets default exit code on org slug failure without code', async () => {
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')
    const { serializeResultJson } = await import(
      '../../utils/output/result-json.mjs'
    )

    const error = {
      ok: false as const,
      error: new Error(UNKNOWN_ERROR),
    }
    vi.mocked(getDefaultOrgSlug).mockResolvedValue(error)
    vi.mocked(serializeResultJson).mockReturnValue('{"error":"Unknown error"}')

    await handleCi(false)

    expect(process.exitCode).toBe(1)
    expect(getDefaultLogger().log).toHaveBeenCalled()
  })

  it('logs debug information', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')
    const { getRepoName, gitBranch } = await import(
      '../../utils/git/operations.mjs'
    )

    vi.mocked(getDefaultOrgSlug).mockResolvedValue({
      ok: true,
      data: 'debug-org',
    })
    vi.mocked(gitBranch).mockResolvedValue('debug-branch')
    vi.mocked(getRepoName).mockResolvedValue('debug-repo')

    await handleCi(false)

    expect(debug).toHaveBeenCalledWith('Starting CI scan')
    expect(debugDir).toHaveBeenCalledWith({ autoManifest: false })
    expect(debug).toHaveBeenCalledWith(
      'CI scan for debug-org/debug-repo on branch debug-branch',
    )
    expect(debugDir).toHaveBeenCalledWith({
      orgSlug: 'debug-org',
      cwd: '/test/project',
      branchName: 'debug-branch',
      repoName: 'debug-repo',
    })
  })

  it('logs debug info on org slug failure', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { getDefaultOrgSlug } = await import('./fetch-default-org-slug.mts')

    const error = {
      ok: false as const,
      error: new Error('Failed'),
    }
    vi.mocked(getDefaultOrgSlug).mockResolvedValue(error)

    await handleCi(false)

    expect(debug).toHaveBeenCalledWith('Failed to get default org slug')
    expect(debugDir).toHaveBeenCalledWith({ orgSlugCResult: error })
  })
})
