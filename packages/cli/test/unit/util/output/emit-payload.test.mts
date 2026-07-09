import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  emitJsonPayload,
  emitPayload,
} from '../../../../src/util/output/emit-payload.mts'

const mockStdoutLog = vi.fn()
const mockStderrLog = vi.fn()

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: (...args: unknown[]) => {
      mockStdoutLog(...args)
    },
    error: (...args: unknown[]) => {
      mockStderrLog(...args)
    },
  }),
}))

describe('emitPayload', () => {
  beforeEach(() => {
    mockStdoutLog.mockClear()
    mockStderrLog.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('emits plain payload as one log call in human mode', () => {
    emitPayload('hello', { flags: {} })
    expect(mockStdoutLog).toHaveBeenCalledTimes(1)
    expect(mockStdoutLog).toHaveBeenCalledWith('hello')
  })

  it('emits BEGIN, payload, END as three log calls under --json', () => {
    emitPayload('{"ok":true}', { flags: { json: true } })
    expect(mockStdoutLog).toHaveBeenCalledTimes(3)
    expect(mockStdoutLog).toHaveBeenNthCalledWith(1, '\0SOCKET_PAYLOAD_BEGIN\0')
    expect(mockStdoutLog).toHaveBeenNthCalledWith(2, '{"ok":true}')
    expect(mockStdoutLog).toHaveBeenNthCalledWith(3, '\0SOCKET_PAYLOAD_END\0')
  })

  it('emits three log calls under --markdown', () => {
    emitPayload('# Hello', { flags: { markdown: true } })
    expect(mockStdoutLog).toHaveBeenCalledTimes(3)
    expect(mockStdoutLog).toHaveBeenNthCalledWith(1, '\0SOCKET_PAYLOAD_BEGIN\0')
    expect(mockStdoutLog).toHaveBeenNthCalledWith(2, '# Hello')
    expect(mockStdoutLog).toHaveBeenNthCalledWith(3, '\0SOCKET_PAYLOAD_END\0')
  })

  it('emits three log calls under --quiet', () => {
    emitPayload('payload', { flags: { quiet: true } })
    expect(mockStdoutLog).toHaveBeenCalledTimes(3)
  })

  it('preserves embedded newlines in the payload (multi-line markdown)', () => {
    const md = '# Title\n\n- item 1\n- item 2\n'
    emitPayload(md, { flags: { markdown: true } })
    // emitPayload strips exactly one trailing newline before logging
    // (logger.log appends its own \n, so keeping the payload's would
    // double it). Intermediate \n bytes inside the payload are
    // preserved untouched.
    expect(mockStdoutLog).toHaveBeenNthCalledWith(
      2,
      '# Title\n\n- item 1\n- item 2',
    )
  })

  it('emitJsonPayload stringifies and wraps', () => {
    emitJsonPayload({ status: 'ok', count: 3 }, { flags: { json: true } })
    expect(mockStdoutLog).toHaveBeenCalledTimes(3)
    expect(mockStdoutLog).toHaveBeenNthCalledWith(
      2,
      '{"status":"ok","count":3}',
    )
  })

  it('never writes to stderr', () => {
    emitPayload('anything', { flags: { json: true } })
    emitPayload('anything', { flags: {} })
    expect(mockStderrLog).not.toHaveBeenCalled()
  })
})
