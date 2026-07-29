/**
 * Unit tests for createPrProvider.
 *
 * Picks GitHubProvider or GitLabProvider based on the remote URL.
 *
 * Test Coverage:
 *
 * - Gitlab.com remote → GitLabProvider
 * - GITLAB_HOST env set → GitLabProvider
 * - Generic 'gitlab' substring → GitLabProvider
 * - Github remote → GitHubProvider (default)
 * - GetGitRemoteUrl returns trimmed lowercase string on success
 * - GetGitRemoteUrl returns '' on non-zero exit
 * - GetGitRemoteUrl returns '' on spawn throw
 * - The remote key is fenced behind --end-of-options
 *
 * Related Files:
 *
 * - Src/util/git/provider-factory.mts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listGitArgvTails } from '../../../../test/helpers/git-spawn-assertions.mts'
import {
  createPrProvider,
  getGitRemoteUrl,
} from '../../../../src/util/git/provider-factory.mts'

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

// Pin git resolution so argv assertions do not depend on the host PATH.
vi.mock(
  import('../../../../src/util/trusted-executable.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    defaultProtectedRoot: vi.fn().mockResolvedValue('/repo'),
    resolveTrustedExecutable: vi.fn().mockResolvedValue({
      environment: { PATH: '/usr/bin' },
      executable: '/usr/bin/git',
    }),
  }),
)

vi.mock(import('../../../../src/util/git/github-provider.mts'), () => ({
  GitHubProvider: class GitHubProviderMock {
    readonly kind = 'github' as const
  },
}))

vi.mock(import('../../../../src/util/git/gitlab-provider.mts'), () => ({
  GitLabProvider: class GitLabProviderMock {
    readonly kind = 'gitlab' as const
  },
}))

const savedGitlabHost = process.env['GITLAB_HOST']

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['GITLAB_HOST']
})

afterEach(() => {
  if (savedGitlabHost === undefined) {
    delete process.env['GITLAB_HOST']
  } else {
    process.env['GITLAB_HOST'] = savedGitlabHost
  }
})

describe('createPrProvider', () => {
  it('returns GitLabProvider when remote points at gitlab.com', async () => {
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: 'git@gitlab.com:org/repo.git\n',
    })
    const provider = (await createPrProvider()) as { kind: string }
    expect(provider.kind).toBe('gitlab')
  })

  it('returns GitLabProvider when GITLAB_HOST env is set', async () => {
    process.env['GITLAB_HOST'] = 'gitlab.example.com'
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: 'git@github.com:org/repo.git\n',
    })
    const provider = (await createPrProvider()) as { kind: string }
    expect(provider.kind).toBe('gitlab')
  })

  it('returns GitLabProvider when remote URL contains "gitlab"', async () => {
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: 'git@self-hosted-gitlab.example.com:org/repo.git\n',
    })
    const provider = (await createPrProvider()) as { kind: string }
    expect(provider.kind).toBe('gitlab')
  })

  it('returns GitHubProvider for github remotes', async () => {
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: 'git@github.com:org/repo.git\n',
    })
    const provider = (await createPrProvider()) as { kind: string }
    expect(provider.kind).toBe('github')
  })

  it('falls back to GitHubProvider when remote is unknown', async () => {
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: 'git@bitbucket.example.com:org/repo.git\n',
    })
    const provider = (await createPrProvider()) as { kind: string }
    expect(provider.kind).toBe('github')
  })
})

describe('getGitRemoteUrl', () => {
  it('returns trimmed lowercased URL on success', async () => {
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: '  HTTPS://Github.COM/Org/Repo.git  \n',
    })
    await expect(getGitRemoteUrl()).resolves.toBe('https://github.com/org/repo.git')
  })

  it('returns empty string when git config exits non-zero', async () => {
    mockSpawn.mockResolvedValue({ code: 1, stdout: '' })
    await expect(getGitRemoteUrl()).resolves.toBe('')
  })

  it('returns empty string when stdout is empty even on status 0', async () => {
    mockSpawn.mockResolvedValue({ code: 0, stdout: '' })
    await expect(getGitRemoteUrl()).resolves.toBe('')
  })

  it('fences the config key behind the operand terminator', async () => {
    mockSpawn.mockResolvedValue({
      code: 0,
      stdout: 'https://github.com/org/repo.git\n',
    })
    await getGitRemoteUrl()
    expect(listGitArgvTails(mockSpawn.mock.calls)).toStrictEqual([
      ['config', '--get', '--end-of-options', 'remote.origin.url'],
    ])
  })

  it('returns empty string when spawnSync throws', async () => {
    mockSpawn.mockRejectedValue(new Error('git not found'))
    await expect(getGitRemoteUrl()).resolves.toBe('')
  })
})
