import { describe, expect, it } from 'vitest'

import { ensureIpcInStdio } from '../../../src/shadow/stdio-ipc.mts'

import type { StdioOptions } from 'node:child_process'

describe('ensureIpcInStdio', () => {
  it('should convert string stdio to array with ipc', () => {
    const result = ensureIpcInStdio('inherit')

    expect(result).toEqual(['inherit', 'inherit', 'inherit', 'ipc'])
  })

  it('should convert pipe string stdio to array with ipc', () => {
    const result = ensureIpcInStdio('pipe')

    expect(result).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
  })

  it('should convert ignore string stdio to array with ipc', () => {
    const result = ensureIpcInStdio('ignore')

    expect(result).toEqual(['ignore', 'ignore', 'ignore', 'ipc'])
  })

  it('should add ipc to array stdio when not present', () => {
    const input: StdioOptions = ['pipe', 'pipe', 'pipe']
    const result = ensureIpcInStdio(input)

    expect(result).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
  })

  it('should preserve array stdio when ipc already present', () => {
    const input: StdioOptions = ['pipe', 'inherit', 'pipe', 'ipc']
    const result = ensureIpcInStdio(input)

    expect(result).toEqual(input)
  })

  it('should handle mixed array stdio types with ipc', () => {
    const input: StdioOptions = ['ignore', 'inherit', 'pipe', 'ipc']
    const result = ensureIpcInStdio(input)

    expect(result).toEqual(input)
  })

  it('should handle empty array stdio', () => {
    const input: StdioOptions = []
    const result = ensureIpcInStdio(input)

    expect(result).toEqual(['ipc'])
  })

  it('should handle single element array stdio', () => {
    const input: StdioOptions = ['pipe']
    const result = ensureIpcInStdio(input)

    expect(result).toEqual(['pipe', 'ipc'])
  })

  it('should handle undefined stdio input', () => {
    const result = ensureIpcInStdio(undefined)

    expect(result).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
  })

  it('should handle null stdio input', () => {
    const result = ensureIpcInStdio(null as any)

    expect(result).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
  })
})
