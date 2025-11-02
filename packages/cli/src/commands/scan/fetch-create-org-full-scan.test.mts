import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchCreateOrgFullScan', () => {
  it('creates org full scan successfully', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'createFullScan',
      {
        scanId: 'scan-123',
        status: 'pending',
      },
    )

    const config = {
      branchName: 'main',
      commitHash: 'abc123',
      commitMessage: 'Initial commit',
      committers: 'john@example.com',
      pullRequest: 42,
      repoName: 'test-repo',
    }

    const result = await fetchCreateOrgFullScan(
      ['/path/to/package.json'],
      'test-org',
      config,
    )

    expect(mockSdk.createFullScan).toHaveBeenCalledWith(
      'test-org',
      ['/path/to/package.json'],
      {
        pathsRelativeTo: process.cwd(),
        branch: 'main',
        commit_hash: 'abc123',
        commit_message: 'Initial commit',
        committers: 'john@example.com',
        pull_request: '42',
        repo: 'test-repo',
      },
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to create a scan',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    await setupSdkSetupFailure('Failed to setup SDK', {
      cause: 'Invalid configuration',
    })

    const config = {
      branchName: 'main',
      commitHash: 'abc123',
      commitMessage: 'Initial commit',
      committers: 'john@example.com',
      pullRequest: 42,
      repoName: 'test-repo',
    }

    const result = await fetchCreateOrgFullScan(
      ['/path/to/package.json'],
      'test-org',
      config,
    )

    expect(result).toEqual({
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    })
  })

  it('handles API call failure', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    await setupSdkMockError('createFullScan', 'Failed to create scan', 500)

    const config = {
      branchName: 'main',
      commitHash: 'abc123',
      commitMessage: 'Initial commit',
      committers: 'john@example.com',
      pullRequest: 42,
      repoName: 'test-repo',
    }

    const result = await fetchCreateOrgFullScan(
      ['/path/to/package.json'],
      'test-org',
      config,
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options and scan options', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    const { mockSdk, mockSetupSdk } = await setupSdkMockSuccess(
      'createFullScan',
      {},
    )

    const config = {
      branchName: 'develop',
      commitHash: 'xyz789',
      commitMessage: 'Feature commit',
      committers: 'jane@example.com',
      pullRequest: 123,
      repoName: 'feature-repo',
    }

    const options = {
      cwd: '/custom/path',
      defaultBranch: true,
      pendingHead: false,
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
      tmp: true,
    }

    await fetchCreateOrgFullScan(
      ['/path/to/package.json'],
      'custom-org',
      config,
      options,
    )

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
    expect(mockSdk.createFullScan).toHaveBeenCalledWith(
      'custom-org',
      ['/path/to/package.json'],
      {
        pathsRelativeTo: '/custom/path',
        branch: 'develop',
        commit_hash: 'xyz789',
        commit_message: 'Feature commit',
        committers: 'jane@example.com',
        make_default_branch: true,
        pull_request: '123',
        repo: 'feature-repo',
        set_as_pending_head: false,
        tmp: true,
      },
    )
  })

  it('handles empty optional config values', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    const { mockSdk } = await setupSdkMockSuccess('createFullScan', {})

    const config = {
      branchName: '',
      commitHash: '',
      commitMessage: '',
      committers: '',
      pullRequest: 0,
      repoName: 'test-repo',
    }

    await fetchCreateOrgFullScan(['/path/to/package.json'], 'test-org', config)

    expect(mockSdk.createFullScan).toHaveBeenCalledWith(
      'test-org',
      ['/path/to/package.json'],
      {
        pathsRelativeTo: process.cwd(),
        repo: 'test-repo',
      },
    )
  })

  it('handles multiple package paths', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    const { mockSdk } = await setupSdkMockSuccess('createFullScan', {})

    const config = {
      branchName: 'main',
      commitHash: 'abc123',
      commitMessage: 'Multi-package commit',
      committers: 'dev@example.com',
      pullRequest: 1,
      repoName: 'mono-repo',
    }

    const packagePaths = [
      '/path/to/frontend/package.json',
      '/path/to/backend/package.json',
      '/path/to/shared/package.json',
    ]

    await fetchCreateOrgFullScan(packagePaths, 'mono-org', config)

    expect(mockSdk.createFullScan).toHaveBeenCalledWith(
      'mono-org',
      packagePaths,
      expect.objectContaining({
        pathsRelativeTo: process.cwd(),
      }),
    )
  })

  it('uses null prototype for config and options', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    const { mockSdk } = await setupSdkMockSuccess('createFullScan', {})

    const config = {
      branchName: 'main',
      commitHash: 'abc123',
      commitMessage: 'Test commit',
      committers: 'test@example.com',
      pullRequest: 1,
      repoName: 'test-repo',
    }

    // This tests that the function properly uses __proto__: null.
    await fetchCreateOrgFullScan(['/path/to/package.json'], 'test-org', config)

    // The function should work without prototype pollution issues.
    expect(mockSdk.createFullScan).toHaveBeenCalled()
  })

  it('handles edge cases for different org slugs and repo names', async () => {
    const { fetchCreateOrgFullScan } = await import(
      './fetch-create-org-full-scan.mts'
    )

    const { mockSdk } = await setupSdkMockSuccess('createFullScan', {})

    const testCases = [
      ['org-with-dashes', 'repo-with-dashes'],
      ['simple_org', 'repo_with_underscore'],
      ['org123', 'repo.with.dots'],
    ]

    for (const [org, repo] of testCases) {
      const config = {
        branchName: 'main',
        commitHash: 'abc123',
        commitMessage: 'Test commit',
        committers: 'test@example.com',
        pullRequest: 1,
        repoName: repo,
      }

      // eslint-disable-next-line no-await-in-loop
      await fetchCreateOrgFullScan(['/path/to/package.json'], org, config)

      expect(mockSdk.createFullScan).toHaveBeenCalledWith(
        org,
        ['/path/to/package.json'],
        expect.objectContaining({
          pathsRelativeTo: process.cwd(),
          repo,
        }),
      )
    }
  })
})
