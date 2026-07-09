/**
 * Unit tests for the setup-manifest-config interactive flow.
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

const mockReadSocketJsonSync = vi.hoisted(() =>
  vi.fn(() => ({ ok: true, data: {} })),
)
const mockWriteSocketJson = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, data: undefined })),
)
vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readSocketJsonSync: mockReadSocketJsonSync,
  writeSocketJson: mockWriteSocketJson,
}))

const mockDetectManifestActions = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock(
  import('../../../../src/commands/manifest/detect-manifest-actions.mts'),
  () => ({
    detectManifestActions: mockDetectManifestActions,
  }),
)

const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
}))

import { setupManifestConfig } from '../../../../src/commands/manifest/setup-manifest-config.mts'

describe('setup-manifest-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadSocketJsonSync.mockReturnValue({ ok: true, data: {} })
    mockWriteSocketJson.mockResolvedValue({ ok: true, data: undefined })
    mockExistsSync.mockReturnValue(false)
    mockDetectManifestActions.mockResolvedValue({})
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
