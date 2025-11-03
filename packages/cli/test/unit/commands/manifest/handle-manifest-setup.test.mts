import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleManifestSetup } from '../../../../src/src/commands/manifest/handle-manifest-setup.mts'

// Mock the dependencies.
const mockOutputManifestSetup = vi.hoisted(() => vi.fn())
const mockSetupManifestConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/manifest/output-manifest-setup.mts', () => ({
  outputManifestSetup: mockOutputManifestSetup,
}))
vi.mock('../../../../src/commands/manifest/setup-manifest-config.mts', () => ({
  setupManifestConfig: mockSetupManifestConfig,
}))

describe('handleManifestSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets up manifest config successfully', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')
    const { outputManifestSetup } = await import('../../../../src/commands/manifest/output-manifest-setup.mts')

    const mockResult = {
      ok: true,
      data: {
        manifestPath: '/test/project/socket.json',
        config: {
          projectIgnorePaths: ['node_modules', 'dist'],
          manifestFiles: ['package.json', 'yarn.lock'],
        },
      },
    }
    mockSetupManifestConfig.mockResolvedValue(mockResult)

    await handleManifestSetup('/test/project', false)

    expect(setupManifestConfig).toHaveBeenCalledWith('/test/project', false)
    expect(outputManifestSetup).toHaveBeenCalledWith(mockResult)
  })

  it('handles setup failure', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')
    const { outputManifestSetup } = await import('../../../../src/commands/manifest/output-manifest-setup.mts')

    const mockError = {
      ok: false,
      error: new Error('Failed to setup manifest'),
    }
    mockSetupManifestConfig.mockResolvedValue(mockError)

    await handleManifestSetup('/test/project', true)

    expect(setupManifestConfig).toHaveBeenCalledWith('/test/project', true)
    expect(outputManifestSetup).toHaveBeenCalledWith(mockError)
  })

  it('handles defaultOnReadError flag true', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')
    const { outputManifestSetup } = await import('../../../../src/commands/manifest/output-manifest-setup.mts')

    const mockResult = {
      ok: true,
      data: { manifestPath: '/test/socket.json' },
    }
    mockSetupManifestConfig.mockResolvedValue(mockResult)

    await handleManifestSetup('/some/dir', true)

    expect(setupManifestConfig).toHaveBeenCalledWith('/some/dir', true)
    expect(outputManifestSetup).toHaveBeenCalledWith(mockResult)
  })

  it('handles defaultOnReadError flag false', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')

    mockSetupManifestConfig.mockResolvedValue({
      ok: true,
      data: {},
    })

    await handleManifestSetup('/project', false)

    expect(setupManifestConfig).toHaveBeenCalledWith('/project', false)
  })

  it('handles empty data result', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')
    const { outputManifestSetup } = await import('../../../../src/commands/manifest/output-manifest-setup.mts')

    const mockResult = {
      ok: true,
      data: {},
    }
    mockSetupManifestConfig.mockResolvedValue(mockResult)

    await handleManifestSetup('/test', false)

    expect(outputManifestSetup).toHaveBeenCalledWith(mockResult)
  })

  it('handles async errors', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')

    mockSetupManifestConfig.mockRejectedValue(new Error('Async error'))

    await expect(handleManifestSetup('/test', false)).rejects.toThrow(
      'Async error',
    )
  })

  it('handles current directory path', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')

    mockSetupManifestConfig.mockResolvedValue({
      ok: true,
      data: { manifestPath: './socket.json' },
    })

    await handleManifestSetup('.', false)

    expect(setupManifestConfig).toHaveBeenCalledWith('.', false)
  })

  it('handles absolute path', async () => {
    const { setupManifestConfig } = await import('../../../../src/commands/manifest/setup-manifest-config.mts')

    mockSetupManifestConfig.mockResolvedValue({
      ok: true,
      data: { manifestPath: '/absolute/path/socket.json' },
    })

    await handleManifestSetup('/absolute/path', true)

    expect(setupManifestConfig).toHaveBeenCalledWith('/absolute/path', true)
  })
})
