import { describe, expect, it } from 'vitest'

import {
  normalizeBackendOutput,
  normalizeBackendPaths,
} from '../../../lib/terminal/output.mts'

import type { TerminalBackend } from '@termless/core'

describe('terminal output normalization', () => {
  it('normalizes exact fixture paths across split backend chunks', () => {
    const received: Buffer[] = []
    const backend = {
      feed(data: Uint8Array) {
        received.push(Buffer.from(data))
      },
    } as unknown as TerminalBackend
    const normalizer = normalizeBackendPaths(backend, ['/tmp/private-fixture'])
    const input = Buffer.from(
      '\u001b[31mWhich 😀 /tmp/private-fixture?\u001b[0m',
    )
    backend.feed(input.subarray(0, 12))
    expect(Buffer.concat(received)).toEqual(input.subarray(0, 12))
    backend.feed(input.subarray(12, 19))
    backend.feed(input.subarray(19, 26))
    backend.feed(input.subarray(26))
    normalizer.flush()
    expect(Buffer.concat(received)).toEqual(
      Buffer.from('\u001b[31mWhich 😀 <NATIVE_FIXTURE>?\u001b[0m'),
    )
  })

  it('normalizes only the manifest Node version across split chunks', () => {
    const received: Buffer[] = []
    const backend = {
      feed(data: Uint8Array) {
        received.push(Buffer.from(data))
      },
    } as unknown as TerminalBackend
    const normalizer = normalizeBackendOutput(backend, [
      { search: 'v27.0.0-alpha.0.0.0', replacement: 'v<NODE_VERSION>' },
    ])
    backend.feed(Buffer.from('Node.js v27.0.0-alpha.'))
    backend.feed(Buffer.from('0.0.0; package 1.2.3'))
    normalizer.flush()
    expect(Buffer.concat(received).toString()).toBe(
      'Node.js v<NODE_VERSION>; package 1.2.3',
    )
    expect(normalizer.matched('v27.0.0-alpha.0.0.0')).toBe(true)
  })

  it('normalizes the socket-patch executable display token across split chunks', () => {
    const received: Buffer[] = []
    const backend = {
      feed(data: Uint8Array) {
        received.push(Buffer.from(data))
      },
    } as unknown as TerminalBackend
    const normalizer = normalizeBackendOutput(backend, [
      { search: 'socket-patch.exe', replacement: 'socket-patch' },
    ])
    backend.feed(Buffer.from('Usage: socket-patch.e'))
    backend.feed(
      Buffer.from('xe apply <PATH>\r\nsocket-patch-tool.exe\nother.exe'),
    )
    normalizer.flush()

    expect(Buffer.concat(received).toString()).toBe(
      'Usage: socket-patch apply <PATH>\r\nsocket-patch-tool.exe\nother.exe',
    )
    expect(normalizer.matched('socket-patch.exe')).toBe(true)
    expect(normalizer.matched('other.exe')).toBe(false)
  })
})
