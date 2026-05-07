/**
 * Unit tests for teardownTabCompletion.
 *
 * Removes Socket CLI tab-completion lines from the user's ~/.bashrc.
 * Mocks node:fs so tests don't touch the real filesystem.
 *
 * Test Coverage:
 * - getBashrcDetails error pass-through
 * - .bashrc absent → "not found" action
 * - .bashrc present without our block → "missing" action
 * - .bashrc present with our block → removes the full block
 * - .bashrc present where the block was edited → falls back to
 *   removing sourcingCommand / completionCommand individually
 * - findRemainingCompletionSetups discovers other targets
 * - homePath unset edge case (skip the bashrc lookup entirely)
 *
 * Related Files:
 * - src/commands/uninstall/teardown-tab-completion.mts - Implementation
 * - src/utils/cli/completion.mts - getBashrcDetails / COMPLETION_CMD_PREFIX
 * - src/constants/paths.mts - homePath
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(
  () => ({
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
  }),
)

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}))

const { mockGetBashrcDetails } = vi.hoisted(() => ({
  mockGetBashrcDetails: vi.fn(),
}))

vi.mock('../../../../src/utils/cli/completion.mts', () => ({
  COMPLETION_CMD_PREFIX: 'source <(socket install completion ',
  getBashrcDetails: mockGetBashrcDetails,
}))

const { mockHomePath } = vi.hoisted(() => ({
  mockHomePath: { value: '/home/test' as string },
}))

vi.mock('../../../../src/constants/paths.mts', () => ({
  get homePath() {
    return mockHomePath.value
  },
}))

const { teardownTabCompletion } = await import(
  '../../../../src/commands/uninstall/teardown-tab-completion.mts'
)

const validDetails = {
  ok: true as const,
  data: {
    completionCommand: 'source <(socket install completion socket)',
    sourcingCommand: 'eval "$(socket install completion socket)"',
    toAddToBashrc:
      '# Socket CLI tab completion\nsource <(socket install completion socket)\n',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHomePath.value = '/home/test'
  mockGetBashrcDetails.mockReturnValue(validDetails)
})

describe('teardownTabCompletion', () => {
  it('passes through getBashrcDetails errors', async () => {
    mockGetBashrcDetails.mockReturnValue({
      ok: false,
      message: 'unknown shell',
      cause: 'unsupported',
    })
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(false)
    expect(mockExistsSync).not.toHaveBeenCalled()
  })

  it('returns "not found" action when ~/.bashrc does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('not found')
      expect(result.data.left).toEqual([])
    }
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('returns "missing" when ~/.bashrc has no completion block', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('export PATH=$PATH:/usr/local/bin\n')
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('missing')
      expect(result.data.left).toEqual([])
    }
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('removes the completion block when present', async () => {
    mockExistsSync.mockReturnValue(true)
    const before = `export PATH=$PATH:/usr/local/bin\n${validDetails.data.toAddToBashrc}\nalias ll='ls -la'\n`
    mockReadFileSync.mockReturnValue(before)
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('removed')
    }
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    const written = mockWriteFileSync.mock.calls[0]![1]
    expect(written).not.toContain(validDetails.data.toAddToBashrc)
  })

  it('falls back to removing sourcing/completion lines individually when the block was edited', async () => {
    mockExistsSync.mockReturnValue(true)
    // Manually-edited bashrc: someone removed the comment and reorganized.
    const partial = `${validDetails.data.toAddToBashrc}\n${validDetails.data.sourcingCommand}\n${validDetails.data.completionCommand}\n`
    mockReadFileSync.mockReturnValue(partial)
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    const written = mockWriteFileSync.mock.calls[0]![1] as string
    expect(written).not.toContain(validDetails.data.sourcingCommand)
    expect(written).not.toContain(validDetails.data.completionCommand)
  })

  it('reports remaining completion-prefix lines in the "left" array', async () => {
    mockExistsSync.mockReturnValue(true)
    const otherTarget = 'source <(socket install completion otherCli)'
    const before = `${validDetails.data.toAddToBashrc}\n${otherTarget}\n`
    mockReadFileSync.mockReturnValue(before)
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.left).toEqual(['otherCli)'])
    }
  })

  it('reports remaining setups in the "missing" branch too', async () => {
    mockExistsSync.mockReturnValue(true)
    const otherTarget = 'source <(socket install completion otherCli)'
    mockReadFileSync.mockReturnValue(otherTarget + '\n')
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('missing')
      expect(result.data.left).toEqual(['otherCli)'])
    }
  })

  it('skips bashrc handling when homePath is empty', async () => {
    mockHomePath.value = ''
    const result = await teardownTabCompletion('socket')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('not found')
    }
    expect(mockExistsSync).not.toHaveBeenCalled()
  })
})
