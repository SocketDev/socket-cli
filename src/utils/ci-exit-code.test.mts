import { afterEach, describe, expect, it } from 'vitest'

import { setCiExitCode, setCiExitCodePolicy } from './ci-exit-code.mts'

describe('ci-exit-code', () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    setCiExitCodePolicy(undefined)
    process.exitCode = originalExitCode
  })

  it('uses distinct codes for findings and infrastructure failures', () => {
    setCiExitCodePolicy({ disableBlocking: false })

    setCiExitCode('blocking')
    expect(process.exitCode).toBe(1)

    setCiExitCode('infrastructure')
    expect(process.exitCode).toBe(3)
  })

  it('uses the configured exit code for API failures', () => {
    setCiExitCodePolicy({
      disableBlocking: false,
      exitCodeOnApiError: 42,
    })

    setCiExitCode('api')

    expect(process.exitCode).toBe(42)
  })

  it('lets disable blocking override findings and infrastructure failures', () => {
    setCiExitCodePolicy({ disableBlocking: true })

    for (const kind of [
      'api',
      'blocking',
      'infrastructure',
      'interrupted',
    ] as const) {
      setCiExitCode(kind)
      expect(process.exitCode).toBe(0)
    }
  })

  it('keeps usage errors non-remappable', () => {
    setCiExitCodePolicy({ disableBlocking: true, exitCodeOnApiError: 0 })

    setCiExitCode('usage')

    expect(process.exitCode).toBe(2)
  })

  it('preserves existing behavior without a CI policy', () => {
    setCiExitCodePolicy(undefined)

    setCiExitCode('api', 17)

    expect(process.exitCode).toBe(17)
  })
})
