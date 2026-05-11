/**
 * Unit tests for setup-scan-config helpers and interactive flow.
 *
 * Related Files:
 * - src/commands/scan/setup-scan-config.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockInput = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockConfirm = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  input: mockInput,
  select: mockSelect,
  confirm: mockConfirm,
}))

const mockGetGithubApiUrl = vi.hoisted(() =>
  vi.fn(() => 'https://api.github.com'),
)
vi.mock('@socketsecurity/lib/env/github', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getGithubApiUrl: mockGetGithubApiUrl,
  }
})

const mockReadSocketJsonSync = vi.hoisted(() =>
  vi.fn(() => ({ ok: true, data: {} })),
)
const mockWriteSocketJson = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, data: undefined })),
)
vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readSocketJsonSync: mockReadSocketJsonSync,
  writeSocketJson: mockWriteSocketJson,
}))

const mockGetRepoName = vi.hoisted(() => vi.fn(async () => 'my-repo'))
const mockGetRepoOwner = vi.hoisted(() => vi.fn(async () => 'my-org'))
const mockGitBranch = vi.hoisted(() => vi.fn(async () => 'main'))
const mockDetectDefaultBranch = vi.hoisted(() => vi.fn(async () => 'main'))
vi.mock('../../../../src/utils/git/operations.mjs', () => ({
  getRepoName: mockGetRepoName,
  getRepoOwner: mockGetRepoOwner,
  gitBranch: mockGitBranch,
  detectDefaultBranch: mockDetectDefaultBranch,
}))

const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
}))

import {
  canceledByUser,
  configureGithub,
  configureScan,
  notCanceled,
  setupScanConfig,
} from '../../../../src/commands/scan/setup-scan-config.mts'

describe('setup-scan-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadSocketJsonSync.mockReturnValue({ ok: true, data: {} })
    mockWriteSocketJson.mockResolvedValue({ ok: true, data: undefined })
    mockExistsSync.mockReturnValue(false)
  })

  describe('canceledByUser', () => {
    it('returns ok=true with canceled=true', () => {
      const result = canceledByUser()
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('logs an info line', () => {
      canceledByUser()
      expect(mockLogger.info).toHaveBeenCalledWith('User canceled')
    })
  })

  describe('notCanceled', () => {
    it('returns ok=true with canceled=false', () => {
      const result = notCanceled()
      expect(result).toEqual({ ok: true, data: { canceled: false } })
    })
  })

  describe('configureScan', () => {
    it('cancels when user aborts the repo prompt', async () => {
      mockInput.mockResolvedValueOnce(undefined)
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when user aborts the workspace prompt', async () => {
      mockInput.mockResolvedValueOnce('repo').mockResolvedValueOnce(undefined)
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when user aborts the branch prompt', async () => {
      mockInput
        .mockResolvedValueOnce('repo')
        .mockResolvedValueOnce('workspace')
        .mockResolvedValueOnce(undefined)
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('writes repo and clears it when user submits empty repo name', async () => {
      // First three prompts: repo, workspace, branch.
      mockInput
        .mockResolvedValueOnce('') // empty repo => deletes config.repo
        .mockResolvedValueOnce('') // empty workspace
        .mockResolvedValueOnce('') // empty branch
      // autoManifest + alwaysReport selects.
      mockSelect.mockResolvedValueOnce('').mockResolvedValueOnce('')
      const config: unknown = {
        repo: 'old-repo',
        workspace: 'old-ws',
        branch: 'old-br',
      }
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.repo).toBeUndefined()
      expect(config.workspace).toBeUndefined()
      expect(config.branch).toBeUndefined()
    })

    it('saves all values when user provides them', async () => {
      mockInput
        .mockResolvedValueOnce('new-repo')
        .mockResolvedValueOnce('new-ws')
        .mockResolvedValueOnce('new-branch')
      mockSelect.mockResolvedValueOnce('yes').mockResolvedValueOnce('yes')
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.repo).toBe('new-repo')
      expect(config.workspace).toBe('new-ws')
      expect(config.branch).toBe('new-branch')
      expect(config.autoManifest).toBe(true)
      expect(config.report).toBe(true)
    })

    it('cancels when autoManifest selector returns undefined', async () => {
      mockInput
        .mockResolvedValueOnce('repo')
        .mockResolvedValueOnce('ws')
        .mockResolvedValueOnce('branch')
      mockSelect.mockResolvedValueOnce(undefined)
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when alwaysReport selector returns undefined', async () => {
      mockInput
        .mockResolvedValueOnce('repo')
        .mockResolvedValueOnce('ws')
        .mockResolvedValueOnce('branch')
      mockSelect
        .mockResolvedValueOnce('') // autoManifest default
        .mockResolvedValueOnce(undefined) // alwaysReport canceled
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('sets report=true when user picks alwaysReport=yes', async () => {
      mockInput
        .mockResolvedValueOnce('r')
        .mockResolvedValueOnce('w')
        .mockResolvedValueOnce('b')
      mockSelect.mockResolvedValueOnce('').mockResolvedValueOnce('yes')
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.report).toBe(true)
    })

    it('sets report=false when user picks alwaysReport=no', async () => {
      mockInput
        .mockResolvedValueOnce('r')
        .mockResolvedValueOnce('w')
        .mockResolvedValueOnce('b')
      mockSelect.mockResolvedValueOnce('').mockResolvedValueOnce('no')
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.report).toBe(false)
    })

    it('deletes report when user picks alwaysReport=empty', async () => {
      mockInput
        .mockResolvedValueOnce('r')
        .mockResolvedValueOnce('w')
        .mockResolvedValueOnce('b')
      mockSelect.mockResolvedValueOnce('').mockResolvedValueOnce('')
      const config: unknown = { report: true }
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.report).toBeUndefined()
    })

    it('sets autoManifest to false when user picks "no"', async () => {
      mockInput
        .mockResolvedValueOnce('r')
        .mockResolvedValueOnce('w')
        .mockResolvedValueOnce('b')
      mockSelect.mockResolvedValueOnce('no').mockResolvedValueOnce('')
      const config: unknown = {}
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.autoManifest).toBe(false)
    })

    it('deletes autoManifest when user picks empty', async () => {
      mockInput
        .mockResolvedValueOnce('r')
        .mockResolvedValueOnce('w')
        .mockResolvedValueOnce('b')
      mockSelect.mockResolvedValueOnce('').mockResolvedValueOnce('')
      const config: unknown = { autoManifest: true }
      const result = await configureScan(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.autoManifest).toBeUndefined()
    })
  })

  describe('configureGithub', () => {
    it('cancels when --all selector returns undefined', async () => {
      mockSelect.mockResolvedValueOnce(undefined)
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('sets all=true when user picks yes', async () => {
      // 1. all=yes select; 2. githubApiUrl input; 3. orgGithub input.
      mockSelect.mockResolvedValueOnce('yes')
      mockInput
        .mockResolvedValueOnce('') // githubApiUrl empty => deletes
        .mockResolvedValueOnce('') // orgGithub empty => deletes
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.all).toBe(true)
    })

    it('sets all=false when user picks no', async () => {
      // Note: when all === 'no' the repos prompt is NOT shown because
      // `if (!all)` evaluates `!"no"` === false. The repos prompt only
      // fires when all is the empty-string ("leave default") option.
      mockSelect.mockResolvedValueOnce('no')
      mockInput
        .mockResolvedValueOnce('') // githubApiUrl empty
        .mockResolvedValueOnce('') // orgGithub empty
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.all).toBe(false)
    })

    it('prompts for repos when user picks "leave default" (empty string)', async () => {
      mockSelect.mockResolvedValueOnce('')
      mockInput
        .mockResolvedValueOnce('r1,r2') // repos
        .mockResolvedValueOnce('') // githubApiUrl
        .mockResolvedValueOnce('') // orgGithub
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.repos).toBe('r1,r2')
    })

    it('cancels when repos prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce('') // empty -> deletes config.all -> shows repos prompt.
      mockInput.mockResolvedValueOnce(undefined) // repos canceled
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when githubApiUrl prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce('no')
      mockInput.mockResolvedValueOnce('repos').mockResolvedValueOnce(undefined) // githubApiUrl canceled
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when orgGithub prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce('yes')
      mockInput
        .mockResolvedValueOnce('') // githubApiUrl
        .mockResolvedValueOnce(undefined) // orgGithub canceled
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('saves orgGithub when user provides one', async () => {
      mockSelect.mockResolvedValueOnce('yes')
      mockInput
        .mockResolvedValueOnce('https://custom.api')
        .mockResolvedValueOnce('my-gh-org')
      const config: unknown = {}
      const result = await configureGithub(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.githubApiUrl).toBe('https://custom.api')
      expect(config.orgGithub).toBe('my-gh-org')
    })

    it('clears all setting when user picks "(leave default)"', async () => {
      mockSelect.mockResolvedValueOnce('default')
      mockInput
        .mockResolvedValueOnce('repos')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
      const config: unknown = { all: true }
      const result = await configureGithub(config, '/cwd')
      expect(result.ok).toBe(true)
      expect(config.all).toBeUndefined()
    })
  })

  describe('setupScanConfig', () => {
    it('cancels when target selector returns undefined', async () => {
      mockSelect.mockResolvedValueOnce(undefined)
      const result = await setupScanConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when target is empty string (cancel option)', async () => {
      mockSelect.mockResolvedValueOnce('')
      const result = await setupScanConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('returns sockJson read error if it fails', async () => {
      mockReadSocketJsonSync.mockReturnValueOnce({
        ok: false,
        message: 'read error',
      })
      const result = await setupScanConfig('/cwd')
      expect(result.ok).toBe(false)
    })

    it('logs about found socket.json when it exists', async () => {
      mockExistsSync.mockReturnValue(true)
      mockSelect.mockResolvedValueOnce('') // cancel after.
      await setupScanConfig('/cwd')
      const infoMsg = mockLogger.info.mock.calls.flat().join(' ')
      expect(infoMsg).toContain('Found')
    })

    it('runs configureGithub when user picks "github" target', async () => {
      mockSelect
        .mockResolvedValueOnce('github') // target
        .mockResolvedValueOnce('yes') // --all yes
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('') // githubApiUrl
        .mockResolvedValueOnce('') // orgGithub
      const result = await setupScanConfig('/cwd')
      expect(result.ok).toBe(true)
      expect(mockWriteSocketJson).toHaveBeenCalled()
    })

    it('runs configureScan and writes when user picks "create" target + writes yes', async () => {
      mockSelect
        .mockResolvedValueOnce('create') // target
        .mockResolvedValueOnce('') // autoManifest default
        .mockResolvedValueOnce('') // alwaysReport default
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('repo') // repo
        .mockResolvedValueOnce('ws') // workspace
        .mockResolvedValueOnce('br') // branch
      const result = await setupScanConfig('/cwd')
      expect(result.ok).toBe(true)
      expect(mockWriteSocketJson).toHaveBeenCalled()
    })

    it('cancels at write-config prompt when user picks "no"', async () => {
      mockSelect
        .mockResolvedValueOnce('create')
        .mockResolvedValueOnce('') // autoManifest
        .mockResolvedValueOnce('') // alwaysReport
        .mockResolvedValueOnce(false) // do not write
      mockInput
        .mockResolvedValueOnce('repo')
        .mockResolvedValueOnce('ws')
        .mockResolvedValueOnce('br')
      const result = await setupScanConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('returns canceled when configureScan canceled mid-flow', async () => {
      mockSelect.mockResolvedValueOnce('create')
      // Cancel inside configureScan at the very first prompt.
      mockInput.mockResolvedValueOnce(undefined)
      const result = await setupScanConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
      // Should NOT have proceeded to write prompt.
      expect(mockWriteSocketJson).not.toHaveBeenCalled()
    })
  })
})
