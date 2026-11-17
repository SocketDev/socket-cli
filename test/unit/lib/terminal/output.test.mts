import { describe, expect, it } from 'vitest'

import {
  normalizeBackendOutput,
  normalizeBackendPaths,
} from '../../../lib/terminal/output.mts'
import { readSeaNodeVersion } from '../../../utils/sea.mts'

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

  it('normalizes only the manifest Node version across split chunks', async () => {
    const received: Buffer[] = []
    const backend = {
      feed(data: Uint8Array) {
        received.push(Buffer.from(data))
      },
    } as unknown as TerminalBackend
    const nodeVersion = await readSeaNodeVersion()
    const normalizer = normalizeBackendOutput(backend, [
      { search: `v${nodeVersion}`, replacement: 'v<NODE_VERSION>' },
    ])
    const splitAt = Math.floor(nodeVersion.length / 2)
    backend.feed(Buffer.from(`Node.js v${nodeVersion.slice(0, splitAt)}`))
    backend.feed(Buffer.from(`${nodeVersion.slice(splitAt)}; package 1.2.3`))
    normalizer.flush()
    expect(Buffer.concat(received).toString()).toBe(
      'Node.js v<NODE_VERSION>; package 1.2.3',
    )
    expect(normalizer.matched(`v${nodeVersion}`)).toBe(true)
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
