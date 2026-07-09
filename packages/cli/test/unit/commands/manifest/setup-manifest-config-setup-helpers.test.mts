/**
 * Unit tests for setup-manifest-config per-ecosystem setup flows.
 *
 * Related Files: - src/commands/manifest/setup-manifest-config.mts
 * (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockInput = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/stdio/prompts'), () => ({
  input: mockInput,
  select: mockSelect,
}))

import {
  setupConda,
  setupGradle,
  setupSbt,
} from '../../../../src/commands/manifest/setup-manifest-config.mts'

describe('setup-manifest-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('setupConda', () => {
    it('cancels when askForEnabled returns undefined', async () => {
      mockSelect.mockResolvedValueOnce(undefined)
      const result = await setupConda({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('disables when user picks "Disable" (false)', async () => {
      mockSelect.mockResolvedValueOnce(false)
      mockInput.mockResolvedValueOnce('environment.yml')
      mockSelect.mockResolvedValueOnce('')
      mockInput.mockResolvedValueOnce('requirements.txt')
      mockSelect.mockResolvedValueOnce('')
      const config: unknown = {}
      const result = await setupConda(config)
      expect(result.ok).toBe(true)
      expect(config.disabled).toBe(true)
      expect(config.infile).toBe('environment.yml')
    })

    it('enables and sets stdin when user enters "-"', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('-')
      mockSelect.mockResolvedValueOnce('')
      mockInput.mockResolvedValueOnce('out.txt')
      mockSelect.mockResolvedValueOnce('yes')
      const config: unknown = { disabled: true }
      const result = await setupConda(config)
      expect(result.ok).toBe(true)
      expect(config.disabled).toBeUndefined()
      expect(config.stdin).toBe(true)
      expect(config.verbose).toBe(true)
    })

    it('cancels when input file prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce(undefined)
      const result = await setupConda({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when stdout prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('environment.yml')
      mockSelect.mockResolvedValueOnce(undefined)
      const result = await setupConda({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('sets stdout=true when user picks "yes" (output prompt skipped)', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('env.yml')
      mockSelect.mockResolvedValueOnce('yes')
      mockSelect.mockResolvedValueOnce('')
      const config: unknown = {}
      const result = await setupConda(config)
      expect(result.ok).toBe(true)
      expect(config.stdout).toBe(true)
    })

    it('prompts for output file after stdout="no", saves outfile', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('env.yml')
      mockSelect.mockResolvedValueOnce('no')
      mockInput.mockResolvedValueOnce('out.txt')
      mockSelect.mockResolvedValueOnce('')
      const config: unknown = {}
      const result = await setupConda(config)
      expect(result.ok).toBe(true)
      // Note: after the output-file prompt fires, stdout is deleted (line 242)
      // so it should be undefined here, not false.
      expect(config.stdout).toBeUndefined()
      expect(config.outfile).toBe('out.txt')
    })

    it('cancels when output file prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('env.yml')
      mockSelect.mockResolvedValueOnce('')
      mockInput.mockResolvedValueOnce(undefined)
      const result = await setupConda({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('promotes "-" output to stdout', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('env.yml')
      mockSelect.mockResolvedValueOnce('')
      mockInput.mockResolvedValueOnce('-')
      mockSelect.mockResolvedValueOnce('')
      const config: unknown = {}
      await setupConda(config)
      expect(config.stdout).toBe(true)
      expect(config.outfile).toBeUndefined()
    })

    it('cancels when verbose prompt is aborted', async () => {
      mockSelect.mockResolvedValueOnce(true)
      mockInput.mockResolvedValueOnce('env.yml')
      mockSelect.mockResolvedValueOnce('yes')
      mockSelect.mockResolvedValueOnce(undefined)
      const result = await setupConda({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })
  })

  describe('setupGradle', () => {
    it('cancels when bin prompt is aborted', async () => {
      mockInput.mockResolvedValueOnce(undefined)
      const result = await setupGradle({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when gradle-opts prompt is aborted', async () => {
      mockInput
        .mockResolvedValueOnce('./gradlew')
        .mockResolvedValueOnce(undefined)
      const result = await setupGradle({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when verbose prompt is aborted', async () => {
      mockInput
        .mockResolvedValueOnce('./gradlew')
        .mockResolvedValueOnce('--info')
      mockSelect.mockResolvedValueOnce(undefined)
      const result = await setupGradle({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('saves bin/gradleOpts/verbose when user provides them', async () => {
      mockInput
        .mockResolvedValueOnce('/usr/bin/gradle')
        .mockResolvedValueOnce('--debug --info')
      mockSelect.mockResolvedValueOnce('yes')
      const config: unknown = {}
      const result = await setupGradle(config)
      expect(result.ok).toBe(true)
      expect(config.bin).toBe('/usr/bin/gradle')
      expect(config.gradleOpts).toBe('--debug --info')
      expect(config.verbose).toBe(true)
    })

    it('clears bin/gradleOpts when user empties them', async () => {
      mockInput.mockResolvedValueOnce('').mockResolvedValueOnce('')
      mockSelect.mockResolvedValueOnce('')
      const config: unknown = { bin: 'old', gradleOpts: 'old', verbose: true }
      const result = await setupGradle(config)
      expect(result.ok).toBe(true)
      expect(config.bin).toBeUndefined()
      expect(config.gradleOpts).toBeUndefined()
      expect(config.verbose).toBeUndefined()
    })

    it('sets verbose=false when user picks "no"', async () => {
      mockInput.mockResolvedValueOnce('./gradlew').mockResolvedValueOnce('')
      mockSelect.mockResolvedValueOnce('no')
      const config: unknown = {}
      const result = await setupGradle(config)
      expect(result.ok).toBe(true)
      expect(config.verbose).toBe(false)
    })
  })

  describe('setupSbt', () => {
    it('cancels when bin prompt is aborted', async () => {
      mockInput.mockResolvedValueOnce(undefined)
      const result = await setupSbt({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when sbt-opts prompt is aborted', async () => {
      mockInput.mockResolvedValueOnce('sbt').mockResolvedValueOnce(undefined)
      const result = await setupSbt({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when stdout prompt is aborted', async () => {
      mockInput.mockResolvedValueOnce('sbt').mockResolvedValueOnce('')
      mockSelect.mockResolvedValueOnce(undefined)
      const result = await setupSbt({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('cancels when output prompt is aborted', async () => {
      mockInput.mockResolvedValueOnce('sbt').mockResolvedValueOnce('')
      mockSelect.mockResolvedValueOnce('') // stdout default
      mockInput.mockResolvedValueOnce(undefined) // outfile
      const result = await setupSbt({})
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('saves all values when user provides them', async () => {
      mockInput
        .mockResolvedValueOnce('/usr/bin/sbt')
        .mockResolvedValueOnce('-Dsbt.opts=foo')
      mockSelect
        .mockResolvedValueOnce('yes') // stdout
        .mockResolvedValueOnce('yes') // verbose
      const config: unknown = {}
      const result = await setupSbt(config)
      expect(result.ok).toBe(true)
      expect(config.bin).toBe('/usr/bin/sbt')
      expect(config.sbtOpts).toBe('-Dsbt.opts=foo')
      expect(config.stdout).toBe(true)
      expect(config.verbose).toBe(true)
    })

    it('clears bin and sbtOpts when user empties them', async () => {
      mockInput.mockResolvedValueOnce('').mockResolvedValueOnce('')
      mockSelect
        .mockResolvedValueOnce('yes') // stdout
        .mockResolvedValueOnce('') // verbose default
      const config: unknown = { bin: 'old', sbtOpts: 'old', verbose: true }
      const result = await setupSbt(config)
      expect(result.ok).toBe(true)
      expect(config.bin).toBeUndefined()
      expect(config.sbtOpts).toBeUndefined()
      expect(config.verbose).toBeUndefined()
    })
  })
})
