/**
 * Unit Tests: Manifest Configuration Setup Handler
 *
 * Purpose:
 * Tests the command handler that initializes Socket manifest configuration (socket.json) for
 * a project. Validates the orchestration between configuration setup and output formatting
 * with support for error recovery through the defaultOnReadError flag.
 *
 * Test Coverage:
 * - Successful manifest configuration setup
 * - Setup failure handling with error output
 * - defaultOnReadError flag behavior (true/false)
 * - Empty data result handling
 * - Current directory and absolute path support
 * - Async error propagation
 *
 * Testing Approach:
 * Mocks setupManifestConfig and outputManifestSetup modules to test handler orchestration
 * without actual file system operations. Tests verify correct parameter passing and
 * CResult pattern handling.
 *
 * Related Files:
 * - src/commands/manifest/handle-manifest-setup.mts - Command handler
 * - src/commands/manifest/setup-manifest-config.mts - Configuration setup logic
 * - src/commands/manifest/output-manifest-setup.mts - Output formatting
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleManifestSetup } from '../../../../src/commands/manifest/handle-manifest-setup.mts'

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
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )
    const { outputManifestSetup } = await import(
      '../../../../src/commands/manifest/output-manifest-setup.mts'
    )

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
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )
    const { outputManifestSetup } = await import(
      '../../../../src/commands/manifest/output-manifest-setup.mts'
    )

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
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )
    const { outputManifestSetup } = await import(
      '../../../../src/commands/manifest/output-manifest-setup.mts'
    )

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
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )

    mockSetupManifestConfig.mockResolvedValue({
      ok: true,
      data: {},
    })

    await handleManifestSetup('/project', false)

    expect(setupManifestConfig).toHaveBeenCalledWith('/project', false)
  })

  it('handles empty data result', async () => {
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )
    const { outputManifestSetup } = await import(
      '../../../../src/commands/manifest/output-manifest-setup.mts'
    )

    const mockResult = {
      ok: true,
      data: {},
    }
    mockSetupManifestConfig.mockResolvedValue(mockResult)

    await handleManifestSetup('/test', false)

    expect(outputManifestSetup).toHaveBeenCalledWith(mockResult)
  })

  it('handles async errors', async () => {
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )

    mockSetupManifestConfig.mockRejectedValue(new Error('Async error'))

    await expect(handleManifestSetup('/test', false)).rejects.toThrow(
      'Async error',
    )
  })

  it('handles current directory path', async () => {
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )

    mockSetupManifestConfig.mockResolvedValue({
      ok: true,
      data: { manifestPath: './socket.json' },
    })

    await handleManifestSetup('.', false)

    expect(setupManifestConfig).toHaveBeenCalledWith('.', false)
  })

  it('handles absolute path', async () => {
    const { setupManifestConfig } = await import(
      '../../../../src/commands/manifest/setup-manifest-config.mts'
    )

    mockSetupManifestConfig.mockResolvedValue({
      ok: true,
      data: { manifestPath: '/absolute/path/socket.json' },
    })

    await handleManifestSetup('/absolute/path', true)

    expect(setupManifestConfig).toHaveBeenCalledWith('/absolute/path', true)
  })
})
