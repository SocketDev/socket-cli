import { beforeEach, expect, it, vi } from 'vitest'
import { handleAsk } from '../../../../src/command/ask/handle-ask.mts'

const mocks = vi.hoisted(() => ({
  match: vi.fn(),
  spawn: vi.fn(),
  output: vi.fn(),
  log: vi.fn(),
}))
vi.mock(import('../../../../src/command/ask/odai-match.mts'), () => ({
  matchAskWithOdai: mocks.match,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mocks.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ log: mocks.log, error: mocks.log }),
}))
vi.mock(import('../../../../src/command/ask/output-ask.mts'), () => ({
  outputAskCommand: mocks.output,
}))
vi.mock(import('node:fs'), async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    promises: { ...actual.promises, readFile: vi.fn().mockResolvedValue('{}') },
  }
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.spawn.mockResolvedValue({ code: 0 })
  mocks.match.mockResolvedValue({ status: 'suggested', actionId: 'scan' })
})
it('never calls AI on a deterministic request', async () => {
  await handleAsk('scan for vulnerabilities', { ai: true, execute: true })
  expect(mocks.match).not.toHaveBeenCalled()
  expect(mocks.spawn).toHaveBeenCalledWith(
    process.execPath,
    [process.argv[1], 'scan', 'create'],
    expect.anything(),
  )
})
it('does not call AI without opt-in', async () => {
  await handleAsk('frobnicate project', { execute: true })
  expect(mocks.match).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})
it('shows a catalog command but never executes an AI suggestion', async () => {
  await handleAsk('frobnicate project', { ai: true, execute: true })
  expect(mocks.match).toHaveBeenCalledOnce()
  expect(mocks.output).toHaveBeenCalledWith(
    'frobnicate project',
    expect.objectContaining({ command: ['scan', 'create'] }),
    expect.anything(),
    expect.objectContaining({ suggestionOnly: true }),
  )
  expect(mocks.spawn).not.toHaveBeenCalled()
  expect(mocks.log.mock.calls.flat().join(' ')).not.toContain('--execute')
})
it.each(['unavailable', 'timed-out', 'invalid', 'abstained'])(
  'keeps %s unresolved and never executes',
  async reason => {
    mocks.match.mockResolvedValue({ status: 'unresolved', reason })
    await handleAsk('frobnicate project', { ai: true, execute: true })
    expect(mocks.output).toHaveBeenCalledWith(
      'frobnicate project',
      undefined,
      expect.anything(),
      { reason },
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
  },
)
it.each([
  'fix vulnerabilities, list issues',
  'check lodash, check express',
  'no fixes please',
  'do not scan',
  'fix then list issues',
  'check lodash and check express',
  'scan; rm -rf example',
])('rejects ambiguity before either matcher: %s', async query => {
  await handleAsk(query, { ai: true, execute: true })
  expect(mocks.match).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})
it.each(['unknown', '__proto__', 'constructor', 'scan --execute'])(
  'revalidates returned catalog identity: %s',
  async actionId => {
    mocks.match.mockResolvedValue({ status: 'suggested', actionId })
    await handleAsk('frobnicate project', { ai: true, execute: true })
    expect(mocks.output).toHaveBeenCalledWith(
      'frobnicate project',
      undefined,
      expect.anything(),
      expect.anything(),
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
  },
)
it('declines a package suggestion without a package argument', async () => {
  mocks.match.mockResolvedValue({ status: 'suggested', actionId: 'package' })
  await handleAsk('frobnicate project', { ai: true, execute: true })
  expect(mocks.output).toHaveBeenCalledWith(
    'frobnicate project',
    undefined,
    expect.anything(),
    expect.objectContaining({ reason: 'missing-argument' }),
  )
  expect(mocks.spawn).not.toHaveBeenCalled()
})
it('does not output or launch a late suggestion after interruption', async () => {
  const controller = new AbortController()
  mocks.match.mockImplementation(async () => {
    controller.abort()
    return { status: 'suggested', actionId: 'scan' }
  })
  await expect(
    handleAsk('frobnicate project', {
      ai: true,
      execute: true,
      abortSignal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(mocks.output).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})
