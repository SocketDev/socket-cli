/**
 * Unit tests for the convertCondaToRequirements file/stdin reader.
 *
 * The pure-string converter is tested next door; this suite covers the
 * I/O wrapper: file existence, empty file, stdin reads, error handling.
 *
 * Related Files:
 * - src/commands/manifest/convert-conda-to-requirements.mts
 */

import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

import { convertCondaToRequirements } from '../../../../src/commands/manifest/convert-conda-to-requirements.mts'

const ENV_YAML = `name: env
channels:
  - defaults
dependencies:
  - python=3.11
  - pip
  - pip:
    - requests==2.31
    - flask
`

describe('convertCondaToRequirements (file)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(ENV_YAML)
  })

  it('reads from a file path', async () => {
    const result = await convertCondaToRequirements(
      'environment.yml',
      '/proj',
      false,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.pip).toContain('requests==2.31')
      expect(result.data.pip).toContain('flask')
    }
  })

  it('returns error when file does not exist', async () => {
    mockExistsSync.mockReturnValueOnce(false)

    const result = await convertCondaToRequirements(
      'environment.yml',
      '/proj',
      false,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('was not found at')
    }
  })

  it('returns error when file is empty', async () => {
    mockReadFileSync.mockReturnValueOnce('')

    const result = await convertCondaToRequirements(
      'environment.yml',
      '/proj',
      false,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('is empty')
    }
  })

  it('logs verbose target path', async () => {
    await convertCondaToRequirements('environment.yml', '/proj', true)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('target:'),
    )
  })
})

describe('convertCondaToRequirements (stdin)', () => {
  let originalStdin: NodeJS.ReadStream
  let stdinFake: EventEmitter & { off?: (...args: any[]) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    originalStdin = process.stdin
    stdinFake = new EventEmitter() as any
    Object.defineProperty(process, 'stdin', {
      value: stdinFake,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true,
    })
  })

  it('reads stdin and resolves on end', async () => {
    const promise = convertCondaToRequirements('-', '/proj', false)
    // Schedule data + end on next tick.
    setImmediate(() => {
      stdinFake.emit('data', Buffer.from(ENV_YAML))
      stdinFake.emit('end')
    })

    const result = await promise
    expect(result.ok).toBe(true)
  })

  it('logs verbose stdin info when --verbose', async () => {
    const promise = convertCondaToRequirements('-', '/proj', true)
    setImmediate(() => {
      stdinFake.emit('data', Buffer.from(ENV_YAML))
      stdinFake.emit('end')
    })

    await promise
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[VERBOSE] reading input from stdin',
    )
  })

  it('returns error when stdin yields no content', async () => {
    const promise = convertCondaToRequirements('-', '/proj', false)
    setImmediate(() => stdinFake.emit('end'))

    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('No data received')
    }
  })

  it('rejects on stdin error event', async () => {
    const promise = convertCondaToRequirements('-', '/proj', true)
    const err = new Error('stdin broke')
    setImmediate(() => stdinFake.emit('error', err))

    await expect(promise).rejects.toThrow('stdin broke')
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('resolves on close with received data', async () => {
    const promise = convertCondaToRequirements('-', '/proj', true)
    setImmediate(() => {
      stdinFake.emit('data', Buffer.from(ENV_YAML))
      stdinFake.emit('close')
    })

    const result = await promise
    expect(result.ok).toBe(true)
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('rejects on close without data', async () => {
    const promise = convertCondaToRequirements('-', '/proj', true)
    setImmediate(() => stdinFake.emit('close'))

    await expect(promise).rejects.toThrow(/No data received/)
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
