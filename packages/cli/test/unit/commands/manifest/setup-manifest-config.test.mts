/**
 * Unit tests for setup-manifest-config helpers.
 *
 * The full setupManifestConfig flow is interactive (prompts the user). The
 * pure helpers `canceledByUser` / `notCanceled` and the prompt-wrapper
 * helpers are testable in isolation.
 *
 * Related Files:
 * - src/commands/manifest/setup-manifest-config.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockInput = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  input: mockInput,
  select: mockSelect,
}))

import {
  askForBin,
  askForEnabled,
  askForInputFile,
  askForOutputFile,
  askForStdout,
  askForVerboseFlag,
  canceledByUser,
  notCanceled,
} from '../../../../src/commands/manifest/setup-manifest-config.mts'

describe('setup-manifest-config helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('canceledByUser', () => {
    it('returns ok=true with canceled=true', () => {
      const result = canceledByUser()
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('logs "User canceled"', () => {
      canceledByUser()
      expect(mockLogger.info).toHaveBeenCalledWith('User canceled')
    })
  })

  describe('notCanceled', () => {
    it('returns ok=true with canceled=false', () => {
      const result = notCanceled()
      expect(result).toEqual({ ok: true, data: { canceled: false } })
    })
  })

  describe('askForStdout', () => {
    it('passes "yes" default for true', async () => {
      mockSelect.mockResolvedValueOnce('yes')
      const result = await askForStdout(true)
      expect(result).toBe('yes')
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'yes' }),
      )
    })

    it('passes "no" default for false', async () => {
      mockSelect.mockResolvedValueOnce('no')
      await askForStdout(false)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'no' }),
      )
    })

    it('passes empty default when undefined', async () => {
      mockSelect.mockResolvedValueOnce('')
      await askForStdout(undefined)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: '' }),
      )
    })
  })

  describe('askForEnabled', () => {
    it('returns the user choice', async () => {
      mockSelect.mockResolvedValueOnce(true)
      const result = await askForEnabled(false)
      expect(result).toBe(true)
    })

    it('passes default based on enabled value', async () => {
      mockSelect.mockResolvedValueOnce(true)
      await askForEnabled(true)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'enable' }),
      )

      mockSelect.mockResolvedValueOnce(false)
      await askForEnabled(false)
      expect(mockSelect).toHaveBeenLastCalledWith(
        expect.objectContaining({ default: 'disable' }),
      )

      mockSelect.mockResolvedValueOnce(undefined)
      await askForEnabled(undefined)
      expect(mockSelect).toHaveBeenLastCalledWith(
        expect.objectContaining({ default: '' }),
      )
    })
  })

  describe('askForInputFile', () => {
    it('passes default name', async () => {
      mockInput.mockResolvedValueOnce('foo.yml')
      const result = await askForInputFile('environment.yml')
      expect(result).toBe('foo.yml')
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'environment.yml' }),
      )
    })

    it('passes empty default by default', async () => {
      mockInput.mockResolvedValueOnce('')
      await askForInputFile()
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: '' }),
      )
    })
  })

  describe('askForOutputFile', () => {
    it('passes default name', async () => {
      mockInput.mockResolvedValueOnce('out.txt')
      const result = await askForOutputFile('default.txt')
      expect(result).toBe('out.txt')
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'default.txt' }),
      )
    })
  })

  describe('askForBin', () => {
    it('passes default bin', async () => {
      mockInput.mockResolvedValueOnce('./bin')
      const result = await askForBin('./gradlew')
      expect(result).toBe('./bin')
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: './gradlew' }),
      )
    })
  })

  describe('askForVerboseFlag', () => {
    it('passes "yes" default for true', async () => {
      mockSelect.mockResolvedValueOnce('yes')
      await askForVerboseFlag(true)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'yes' }),
      )
    })

    it('passes "no" default for false', async () => {
      mockSelect.mockResolvedValueOnce('no')
      await askForVerboseFlag(false)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: 'no' }),
      )
    })

    it('passes empty default for undefined', async () => {
      mockSelect.mockResolvedValueOnce('')
      await askForVerboseFlag(undefined)
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: '' }),
      )
    })
  })
})
