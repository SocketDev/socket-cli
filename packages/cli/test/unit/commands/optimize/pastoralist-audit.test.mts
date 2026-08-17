import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runPastoralistAudit } from '../../../../src/commands/optimize/pastoralist-audit.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: spawnMock,
}))

describe('runPastoralistAudit', () => {
  beforeEach(() => {
    spawnMock.mockResolvedValue({ code: 0, stdout: '' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('spawns the pinned pastoralist bin against the project root', async () => {
    const result = await runPastoralistAudit('/repo')
    expect(result.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      [
        expect.stringMatching(/pastoralist[/\\]dist[/\\]index\.js$/),
        '--root',
        '/repo',
      ],
      expect.objectContaining({ cwd: '/repo' }),
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Pastoralist override audit complete.',
    )
  })

  it('reports a non-zero pastoralist exit without throwing', async () => {
    spawnMock.mockResolvedValue({ code: 2, stdout: '' })
    const result = await runPastoralistAudit('/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('pastoralist exited 2')
  })
})
