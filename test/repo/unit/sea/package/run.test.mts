import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyNativePackage: vi.fn() }))

vi.mock(
  import('../../../../../scripts/repo/build/sea/package/check.mts'),
  () => ({ verifyNativePackage: mocks.verifyNativePackage }),
)

import { main } from '../../../../../scripts/repo/build/sea/package/run.mts'

afterEach(() => {
  vi.restoreAllMocks()
  mocks.verifyNativePackage.mockReset().mockResolvedValue({
    requestedTarget: 'darwin-arm64',
    launcherTarget: 'darwin-arm64',
  })
})

describe('native package verifier CLI', () => {
  it('forwards --gatekeeper to package verification', async () => {
    mocks.verifyNativePackage.mockResolvedValue({
      requestedTarget: 'darwin-arm64',
      launcherTarget: 'darwin-arm64',
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main({
      argv: [
        '--package-root',
        '/fixture/package',
        '--target',
        'darwin-arm64',
        '--gatekeeper',
      ],
    })

    expect(mocks.verifyNativePackage).toHaveBeenCalledWith({
      packageRoot: '/fixture/package',
      target: 'darwin-arm64',
      gatekeeper: true,
    })
  })
})
