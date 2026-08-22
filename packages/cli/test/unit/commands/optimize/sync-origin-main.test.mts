import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { syncOriginMain } from '../../../../src/commands/optimize/sync-origin-main.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const spawnGitMock = vi.hoisted(() => vi.fn())
const gitBranchMock = vi.hoisted(() => vi.fn())
const detectDefaultBranchMock = vi.hoisted(() => vi.fn())
const gitUnstagedModifiedFilesMock = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('../../../../src/util/git/spawn-git.mts'), () => ({
  spawnGit: spawnGitMock,
}))

vi.mock(import('../../../../src/util/git/git-branch-ops.mts'), () => ({
  detectDefaultBranch: detectDefaultBranchMock,
}))

vi.mock(import('../../../../src/util/git/git-remote-info.mts'), () => ({
  gitBranch: gitBranchMock,
  gitUnstagedModifiedFiles: gitUnstagedModifiedFilesMock,
}))

function spawnSequence(
  map: Record<
    string,
    { code?: number | undefined; stdout?: string | undefined }
  >,
) {
  return async (args: readonly string[]) => {
    const key = args.join(' ')
    for (const [prefix, result] of Object.entries(map)) {
      if (key.startsWith(prefix)) {
        if (result.code !== undefined && result.code !== 0) {
          throw new Error(`exit ${result.code}`)
        }
        return { code: 0, stdout: result.stdout ?? '' }
      }
    }
    throw new Error(`unexpected git call: ${key}`)
  }
}

describe('syncOriginMain', () => {
  beforeEach(() => {
    detectDefaultBranchMock.mockResolvedValue('main')
    gitBranchMock.mockResolvedValue('main')
    gitUnstagedModifiedFilesMock.mockResolvedValue({ ok: true, data: [] })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('skips on a non-default branch', async () => {
    gitBranchMock.mockResolvedValue('feature/my-feature')
    const result = await syncOriginMain('/repo')
    expect(result).toEqual({
      ok: true,
      reason: 'on feature/my-feature, not main',
      synced: false,
    })
    expect(spawnGitMock).not.toHaveBeenCalled()
  })

  it('skips on a detached HEAD', async () => {
    gitBranchMock.mockResolvedValue(undefined)
    const result = await syncOriginMain('/repo')
    expect(result.synced).toBe(false)
    expect(result.reason).toContain('detached HEAD')
  })

  it('skips a dirty tree', async () => {
    gitUnstagedModifiedFilesMock.mockResolvedValue({
      ok: true,
      data: ['packages/cli/package.json'],
    })
    const result = await syncOriginMain('/repo')
    expect(result.reason).toContain('unstaged changes')
    expect(spawnGitMock).not.toHaveBeenCalled()
  })

  it('skips when already current', async () => {
    spawnGitMock.mockImplementation(
      spawnSequence({
        'fetch origin main': { code: 0 },
        'rev-list --count HEAD..origin/main': { stdout: '0\n' },
      }),
    )
    const result = await syncOriginMain('/repo')
    expect(result).toEqual({
      ok: true,
      reason: 'already current with origin/main',
      synced: false,
    })
  })

  it('fast-forwards when strictly behind', async () => {
    spawnGitMock.mockImplementation(
      spawnSequence({
        'fetch origin main': { code: 0 },
        'rev-list --count HEAD..origin/main': { stdout: '3\n' },
        'merge --ff-only origin/main': { code: 0 },
      }),
    )
    const result = await syncOriginMain('/repo')
    expect(result).toEqual({ ok: true, reason: '', synced: true })
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Fast-forwarded main to origin/main.',
    )
  })

  it('reports a fetch failure without throwing', async () => {
    spawnGitMock.mockImplementation(
      spawnSequence({
        'fetch origin main': { code: 128 },
      }),
    )
    const result = await syncOriginMain('/repo')
    expect(result.ok).toBe(false)
    expect(result.synced).toBe(false)
    expect(result.reason).toContain('failed to fetch')
  })

  it('reports a diverged branch without throwing', async () => {
    spawnGitMock.mockImplementation(
      spawnSequence({
        'fetch origin main': { code: 0 },
        'rev-list --count HEAD..origin/main': { stdout: '2\n' },
        'merge --ff-only origin/main': { code: 1 },
      }),
    )
    const result = await syncOriginMain('/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('cannot fast-forward')
  })

  it('reports not-a-git-repo when git itself fails', async () => {
    gitBranchMock.mockRejectedValue(new Error('not a git repository'))
    const result = await syncOriginMain('/not-a-repo')
    expect(result).toEqual({
      ok: false,
      reason: 'not a git repository',
      synced: false,
    })
  })
})
