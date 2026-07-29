/**
 * Unit tests for the CLI User-Agent helper.
 *
 * Related Files: - src/util/socket/user-agent.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCliName = vi.hoisted(() => vi.fn(() => 'socket'))
const mockGetCliVersion = vi.hoisted(() => vi.fn(() => '1.2.3'))

vi.mock(import('../../../../src/env/cli-name.mts'), () => ({
  getCliName: mockGetCliName,
}))
vi.mock(import('../../../../src/env/cli-version.mts'), () => ({
  getCliVersion: mockGetCliVersion,
}))

describe('getCliUserAgent', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('composes product token, node version, and platform/arch', async () => {
    const { getCliUserAgent } =
      await import('../../../../src/util/socket/user-agent.mts')

    expect(getCliUserAgent()).toBe(
      `socket/1.2.3 node/${process.version} ${process.platform}/${process.arch}`,
    )
  })

  it('caches the composed value', async () => {
    const { getCliUserAgent } =
      await import('../../../../src/util/socket/user-agent.mts')
    getCliUserAgent()
    mockGetCliName.mockClear()
    getCliUserAgent()

    expect(mockGetCliName).not.toHaveBeenCalled()
  })
})
