import { afterEach, expect, it, vi } from 'vitest'
import { cmdAsk } from '../../../../src/command/ask/cmd-ask.mts'
const handle = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/command/ask/handle-ask.mts'), () => ({
  handleAsk: handle,
}))
const originalExitCode = process.exitCode
afterEach(() => {
  process.exitCode = originalExitCode
  vi.resetAllMocks()
})
it('aborts an interactive request and preserves exit130 on Ctrl+C', async () => {
  const listenerCount = process.listenerCount('SIGINT')
  handle.mockImplementation(async (query, options) => {
    expect(query).toBe('frobnicate project')
    expect(options.ai).toBe(true)
    expect(options.execute).toBe(true)
    expect(options.abortSignal.aborted).toBe(false)
    process.emit('SIGINT')
    options.abortSignal.throwIfAborted()
  })
  await cmdAsk.run(
    ['frobnicate project', '--ai', '--execute'],
    { url: 'file:///example/cmd-ask.mts' },
    { parentName: 'socket' },
  )
  expect(process.exitCode).toBe(130)
  expect(process.listenerCount('SIGINT')).toBe(listenerCount)
})
it('removes its signal handler when inference fails', async () => {
  const listenerCount = process.listenerCount('SIGINT')
  const failure = new Error('example failure')
  handle.mockRejectedValue(failure)
  await expect(
    cmdAsk.run(
      ['frobnicate project', '--ai'],
      { url: 'file:///example/cmd-ask.mts' },
      { parentName: 'socket' },
    ),
  ).rejects.toBe(failure)
  expect(process.listenerCount('SIGINT')).toBe(listenerCount)
})
