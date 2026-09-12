import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock(import('../../../scripts/util/asset-manager.mts'), () => ({
  AssetManager: class {},
}))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const runtimeReport = process.report.getReport()

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('detectMusl runtime evidence', () => {
  it.each([
    { glibcVersionRuntime: '2.39', expected: false },
    { glibcVersionRuntime: undefined, expected: true },
  ])(
    'detects Linux libc from $glibcVersionRuntime',
    async ({ glibcVersionRuntime, expected }) => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const getReport = vi.spyOn(process.report, 'getReport').mockReturnValue({
        ...runtimeReport,
        header: { ...runtimeReport.header, glibcVersionRuntime },
      })
      const { detectMusl } =
        await import('../../../scripts/util/asset-manager-compat.mts')
      expect(detectMusl()).toBe(expected)
      expect(detectMusl()).toBe(expected)
      expect(getReport).toHaveBeenCalledTimes(1)
    },
  )

  it('does not inspect reports outside Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const getReport = vi.spyOn(process.report, 'getReport')
    const { detectMusl } =
      await import('../../../scripts/util/asset-manager-compat.mts')
    expect(detectMusl()).toBe(false)
    expect(getReport).not.toHaveBeenCalled()
  })

  it('retains the glibc fallback when runtime inspection fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    vi.spyOn(process.report, 'getReport').mockImplementation(() => {
      throw new Error('report unavailable')
    })
    const { detectMusl } =
      await import('../../../scripts/util/asset-manager-compat.mts')
    expect(detectMusl()).toBe(false)
  })
})
