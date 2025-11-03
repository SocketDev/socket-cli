import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleCreateGithubScan } from '../../../../src/src/commands/scan/handle-create-github-scan.mts'

// Mock the dependencies.
const mockCreateScanFromGithub = vi.hoisted(() => vi.fn())
const mockOutputScanGithub = vi.hoisted(() => vi.fn())

vi.mock('../../../../../src/commands/scan/create-scan-from-github.mts', () => ({
  createScanFromGithub: mockCreateScanFromGithub,
}))

vi.mock('../../../../../src/commands/scan/output-scan-github.mts', () => ({
  outputScanGithub: mockOutputScanGithub,
}))

describe('handleCreateGithubScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates GitHub scan and outputs result successfully', async () => {
    const { createScanFromGithub } = await import(
      '../../../../../src/commands/scan/create-scan-from-github.mts'
    )
    const { outputScanGithub } = await import('../../../../../src/commands/scan/output-scan-github.mts')
    const mockCreate = mockCreateScanFromGithub
    const mockOutput = mockOutputScanGithub

    const mockResult = createSuccessResult({
      scanId: 'scan-123',
      repositories: ['repo1', 'repo2'],
      status: 'created',
      createdAt: '2025-01-01T00:00:00Z',
    })
    mockCreate.mockResolvedValue(mockResult)

    await handleCreateGithubScan({
      all: true,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'ghp_token123',
      interactive: false,
      orgGithub: 'github-org',
      orgSlug: 'test-org',
      outputKind: 'json',
      repos: 'repo1,repo2',
    })

    expect(mockCreate).toHaveBeenCalledWith({
      all: true,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'ghp_token123',
      interactive: false,
      orgSlug: 'test-org',
      orgGithub: 'github-org',
      outputKind: 'json',
      repos: 'repo1,repo2',
    })
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'json')
  })

  it('handles creation failure', async () => {
    const { createScanFromGithub } = await import(
      './create-scan-from-github.mts'
    )
    const { outputScanGithub } = await import('../../../../../src/commands/scan/output-scan-github.mts')
    const mockCreate = mockCreateScanFromGithub
    const mockOutput = mockOutputScanGithub

    const mockError = createErrorResult('GitHub authentication failed')
    mockCreate.mockResolvedValue(mockError)

    await handleCreateGithubScan({
      all: false,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'invalid',
      interactive: false,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'text',
      repos: '',
    })

    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles all repositories flag', async () => {
    const { createScanFromGithub } = await import(
      './create-scan-from-github.mts'
    )
    const mockCreate = mockCreateScanFromGithub

    mockCreate.mockResolvedValue(createSuccessResult({}))

    await handleCreateGithubScan({
      all: true,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'token',
      interactive: false,
      orgGithub: 'my-org',
      orgSlug: 'my-org',
      outputKind: 'json',
      repos: '',
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ all: true, repos: '' }),
    )
  })

  it('handles interactive mode', async () => {
    const { createScanFromGithub } = await import(
      './create-scan-from-github.mts'
    )
    const mockCreate = mockCreateScanFromGithub

    mockCreate.mockResolvedValue(createSuccessResult({}))

    await handleCreateGithubScan({
      all: false,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'token',
      interactive: true,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'json',
      repos: 'repo1',
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true }),
    )
  })

  it('handles markdown output format', async () => {
    const { createScanFromGithub } = await import(
      './create-scan-from-github.mts'
    )
    const { outputScanGithub } = await import('../../../../../src/commands/scan/output-scan-github.mts')
    const mockCreate = mockCreateScanFromGithub
    const mockOutput = mockOutputScanGithub

    mockCreate.mockResolvedValue(createSuccessResult({}))

    await handleCreateGithubScan({
      all: false,
      githubApiUrl: 'https://github.enterprise.com',
      githubToken: 'token',
      interactive: false,
      orgGithub: 'enterprise-org',
      orgSlug: 'enterprise-org',
      outputKind: 'markdown',
      repos: 'repo1,repo2,repo3',
    })

    expect(mockOutput).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('converts parameters to proper types', async () => {
    const { createScanFromGithub } = await import(
      './create-scan-from-github.mts'
    )
    const mockCreate = mockCreateScanFromGithub

    mockCreate.mockResolvedValue(createSuccessResult({}))

    // Test with various falsy values.
    await handleCreateGithubScan({
      all: 0 as any,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'token',
      interactive: null as any,
      orgGithub: 'org',
      orgSlug: 'org',
      outputKind: 'json',
      repos: undefined as any,
    })

    expect(mockCreate).toHaveBeenCalledWith({
      all: false,
      githubApiUrl: 'https://api.github.com',
      githubToken: 'token',
      interactive: false,
      orgSlug: 'org',
      orgGithub: 'org',
      outputKind: 'json',
      repos: '',
    })
  })
})
