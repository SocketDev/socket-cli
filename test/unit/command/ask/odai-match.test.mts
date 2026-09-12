import { beforeEach, expect, it, vi } from 'vitest'
import { matchAskWithOdai } from '../../../../src/command/ask/odai-match.mts'

const mocks = vi.hoisted(() => ({ classify: vi.fn(), operation: vi.fn() }))
vi.mock(import('@socketsecurity/odai/node'), () => ({
  classifyIntent: mocks.classify,
  withOdaiModel: mocks.operation,
}))
const candidates = [{ id: 'scan', description: 'Scan project dependencies' }]
beforeEach(() => {
  vi.resetAllMocks()
  mocks.operation.mockImplementation(async callback => callback({}))
  mocks.classify.mockResolvedValue({
    ok: true,
    data: { actionId: 'scan' },
    raw: '',
  })
})
it('classifies only the caller catalog within one bounded lifecycle', async () => {
  expect(await matchAskWithOdai('inspect my dependencies', candidates)).toEqual(
    { status: 'suggested', actionId: 'scan' },
  )
  expect(mocks.operation).toHaveBeenCalledWith(expect.any(Function), {
    timeoutMs: 5000,
    abortSignal: undefined,
  })
  expect(mocks.classify).toHaveBeenCalledWith(
    {},
    { query: 'inspect my dependencies', candidates },
  )
})
it.each([
  { ok: false },
  { ok: true },
  { ok: true, data: {} },
  { ok: true, data: { actionId: 'unknown' } },
  { ok: true, data: { actionId: 'scan', command: 'execute' } },
])('refuses invalid task results', async result => {
  mocks.classify.mockResolvedValue(result)
  expect(await matchAskWithOdai('example query', candidates)).toEqual({
    status: 'unresolved',
    reason: 'invalid',
  })
})
it('preserves explicit abstention', async () => {
  mocks.classify.mockResolvedValue(
    JSON.parse('{"ok":true,"data":{"actionId":null},"raw":""}'),
  )
  expect(await matchAskWithOdai('example query', candidates)).toEqual({
    status: 'unresolved',
    reason: 'abstained',
  })
})
it.each([
  [new Error('backend unavailable'), 'unavailable'],
  [new DOMException('deadline', 'TimeoutError'), 'timed-out'],
])('reports bounded failure without backend text', async (error, reason) => {
  mocks.operation.mockRejectedValue(error)
  expect(await matchAskWithOdai('example query', candidates)).toEqual({
    status: 'unresolved',
    reason,
  })
})
it('does no work for a pre-aborted call', async () => {
  const signal = AbortSignal.abort()
  await expect(
    matchAskWithOdai('example query', candidates, { abortSignal: signal }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(mocks.operation).not.toHaveBeenCalled()
})
it('propagates cancellation instead of reporting an unavailable model', async () => {
  mocks.operation.mockRejectedValue(new DOMException('cancelled', 'AbortError'))
  await expect(
    matchAskWithOdai('example query', candidates),
  ).rejects.toMatchObject({ name: 'AbortError' })
})
