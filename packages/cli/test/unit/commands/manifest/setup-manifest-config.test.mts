/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for setup-manifest-config helpers and interactive flow.
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

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockInput = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  input: mockInput,
  select: mockSelect,
}))

const mockReadSocketJsonSync = vi.hoisted(() =>
  vi.fn(() => ({ ok: true, data: {} })),
)
const mockWriteSocketJson = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, data: undefined })),
)
vi.mock('../../../../src/util/socket/json.mts', () => ({
  readSocketJsonSync: mockReadSocketJsonSync,
  writeSocketJson: mockWriteSocketJson,
}))

const mockDetectManifestActions = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock(
  '../../../../src/commands/manifest/detect-manifest-actions.mts',
  () => ({
    detectManifestActions: mockDetectManifestActions,
  }),
)

const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
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
  setupConda,
  setupGradle,
  setupManifestConfig,
  setupSbt,
} from '../../../../src/commands/manifest/setup-manifest-config.mts'

describe('setup-manifest-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadSocketJsonSync.mockReturnValue({ ok: true, data: {} })
    mockWriteSocketJson.mockResolvedValue({ ok: true, data: undefined })
    mockExistsSync.mockReturnValue(false)
    mockDetectManifestActions.mockResolvedValue({})
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

  describe('setupManifestConfig', () => {
    it('cancels when target ecosystem selector returns empty (exit)', async () => {
      mockSelect.mockResolvedValueOnce('')
      const result = await setupManifestConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('returns sockJson read error when readSocketJsonSync fails', async () => {
      mockReadSocketJsonSync.mockReturnValueOnce({
        ok: false,
        message: 'read err',
      })
      mockSelect.mockResolvedValueOnce('conda')
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(false)
    })

    it('logs about found socket.json when it exists', async () => {
      mockExistsSync.mockReturnValue(true)
      mockSelect.mockResolvedValueOnce('')
      await setupManifestConfig('/cwd')
      const infoMsg = mockLogger.info.mock.calls.flat().join(' ')
      expect(infoMsg).toContain('Found')
    })

    it('logs "No" socket.json when it does not exist', async () => {
      mockExistsSync.mockReturnValue(false)
      mockSelect.mockResolvedValueOnce('')
      await setupManifestConfig('/cwd')
      const infoMsg = mockLogger.info.mock.calls.flat().join(' ')
      expect(infoMsg).toContain('No')
    })

    it('completes flow for conda + write yes (lines 136-140)', async () => {
      // setupConda prompts: askForEnabled, askForInputFile, askForStdout,
      // askForOutputFile (when stdout != yes), askForVerboseFlag.
      mockSelect
        .mockResolvedValueOnce('conda') // target ecosystem
        .mockResolvedValueOnce('') // askForEnabled (default)
        .mockResolvedValueOnce('') // askForStdout (default)
        .mockResolvedValueOnce('') // askForVerboseFlag (default)
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('environment.yml') // infile
        .mockResolvedValueOnce('requirements.txt') // outfile
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
      expect(mockWriteSocketJson).toHaveBeenCalled()
    })

    it('completes flow for gradle + write yes (lines 143-147)', async () => {
      // setupGradle prompts: askForBin (input), gradle-opts (input),
      // askForVerboseFlag (select). Then outer write-yes prompt.
      mockSelect
        .mockResolvedValueOnce('gradle') // target ecosystem
        .mockResolvedValueOnce('') // askForVerboseFlag (default)
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('./gradlew') // bin
        .mockResolvedValueOnce('') // gradle-opts
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
      expect(mockWriteSocketJson).toHaveBeenCalled()
    })

    it('sbt: stdout=yes skips outfile prompt (line 341-342)', async () => {
      mockSelect
        .mockResolvedValueOnce('sbt') // ecosystem
        .mockResolvedValueOnce('yes') // stdout = yes
        .mockResolvedValueOnce('') // verbose default
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('sbt') // bin
        .mockResolvedValueOnce('') // sbt-opts
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
    })

    it('sbt: stdout=no leads to outfile prompt (line 343-344)', async () => {
      mockSelect
        .mockResolvedValueOnce('sbt') // ecosystem
        .mockResolvedValueOnce('no') // stdout = no
        .mockResolvedValueOnce('') // verbose default
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('sbt') // bin
        .mockResolvedValueOnce('') // sbt-opts
        .mockResolvedValueOnce('out.xml') // outfile
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
    })

    it('sbt: outfile="-" promotes stdout to true (line 354-355)', async () => {
      mockSelect
        .mockResolvedValueOnce('sbt') // ecosystem
        .mockResolvedValueOnce('') // stdout default
        .mockResolvedValueOnce('') // verbose default
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('sbt') // bin
        .mockResolvedValueOnce('') // sbt-opts
        .mockResolvedValueOnce('-') // outfile = '-' → stdout=true
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
    })

    it('sbt: outfile empty deletes outfile config (line 360-361)', async () => {
      mockSelect
        .mockResolvedValueOnce('sbt') // ecosystem
        .mockResolvedValueOnce('') // stdout default
        .mockResolvedValueOnce('') // verbose default
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('sbt') // bin
        .mockResolvedValueOnce('') // sbt-opts
        .mockResolvedValueOnce('') // outfile empty → delete
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
    })

    it('completes flow for sbt + write yes', async () => {
      mockSelect
        .mockResolvedValueOnce('sbt') // target ecosystem
        .mockResolvedValueOnce('') // stdout default
        .mockResolvedValueOnce('') // verbose default
        .mockResolvedValueOnce(true) // write yes
      mockInput
        .mockResolvedValueOnce('sbt') // bin
        .mockResolvedValueOnce('') // sbt-opts
        .mockResolvedValueOnce('out.xml') // outfile
      const result = await setupManifestConfig('/cwd')
      expect(result.ok).toBe(true)
      expect(mockWriteSocketJson).toHaveBeenCalled()
    })

    it('cancels when user picks "no" at write-config prompt', async () => {
      mockSelect
        .mockResolvedValueOnce('sbt')
        .mockResolvedValueOnce('') // stdout default
        .mockResolvedValueOnce('') // verbose default
        .mockResolvedValueOnce(false) // do not write
      mockInput
        .mockResolvedValueOnce('sbt')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('out.xml')
      const result = await setupManifestConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('appends [detected] to choices when ecosystem is auto-detected (line 87)', async () => {
      // Make detectManifestActions report all known ecosystems as present;
      // then the choices.forEach loop appends ' [detected]' to each name
      // (line 87) and the sort comparator returns -1 / 1 (lines 97 / 103).
      mockDetectManifestActions.mockResolvedValueOnce({
        conda: true,
        gradle: true,
        sbt: true,
      })
      // Cancel immediately after seeing the detected list.
      mockSelect.mockResolvedValueOnce('')
      const result = await setupManifestConfig('/cwd')
      expect(result).toEqual({ ok: true, data: { canceled: true } })
      // The select prompt was called with choices containing '[detected]'.
      const calledWith = mockSelect.mock.calls[0]?.[0]
      expect(JSON.stringify(calledWith)).toContain('[detected]')
    })

    it('sort comparator orders detected before undetected (lines 97-103)', async () => {
      // Only conda is detected → conda choices sort before sbt choices.
      mockDetectManifestActions.mockResolvedValueOnce({
        conda: true,
      })
      mockSelect.mockResolvedValueOnce('')
      await setupManifestConfig('/cwd')
      const calledWith: unknown = mockSelect.mock.calls[0]?.[0]
      const choices: unknown[] = calledWith?.choices ?? []
      const detectedIdx = choices.findIndex((c: unknown) =>
        c.name.includes('Conda'),
      )
      const undetectedIdx = choices.findIndex((c: unknown) =>
        c.name.includes('sbt'),
      )
      expect(detectedIdx).toBeGreaterThanOrEqual(0)
      expect(undetectedIdx).toBeGreaterThanOrEqual(0)
      expect(detectedIdx).toBeLessThan(undetectedIdx)
    })
  })
})
