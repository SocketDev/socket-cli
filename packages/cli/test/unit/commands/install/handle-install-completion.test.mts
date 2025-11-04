/**
 * Unit Tests: Tab Completion Installation Handler
 *
 * Purpose:
 * Tests the command handler that installs shell tab completion support for the Socket CLI.
 * Validates the orchestration between setup and output modules for different shell environments
 * (bash, zsh, fish, powershell).
 *
 * Test Coverage:
 * - Successful completion installation for various shells
 * - Installation failure handling
 * - Multiple shell target support (bash, zsh, fish, powershell)
 * - Empty and invalid target name handling
 * - Unsupported shell detection
 * - Async error propagation
 *
 * Testing Approach:
 * Mocks setupTabCompletion and outputInstallCompletion modules to test the handler's
 * orchestration logic without actual file system modifications. Tests verify correct
 * parameter passing and CResult pattern handling.
 *
 * Related Files:
 * - src/commands/install/handle-install-completion.mts - Command handler
 * - src/commands/install/setup-tab-completion.mts - Completion setup logic
 * - src/commands/install/output-install-completion.mts - Output formatting
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleInstallCompletion } from '../../../../src/commands/install/handle-install-completion.mts'

// Mock the dependencies.
vi.mock('../../../../src/commands/install/output-install-completion.mts', () => ({
  outputInstallCompletion: vi.fn(),
}))
vi.mock('../../../../src/commands/install/setup-tab-completion.mts', () => ({
  setupTabCompletion: vi.fn(),
}))

describe('handleInstallCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs completion successfully', async () => {
    const { setupTabCompletion } = await import('../../../../src/commands/install/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      '../../../../src/commands/install/output-install-completion.mts'
    )

    vi.mocked(setupTabCompletion).mockResolvedValue({
      ok: true,
      value: 'Completion installed successfully',
    })

    await handleInstallCompletion('bash')

    expect(setupTabCompletion).toHaveBeenCalledWith('bash')
    expect(outputInstallCompletion).toHaveBeenCalledWith({
      ok: true,
      value: 'Completion installed successfully',
    })
  })

  it('handles installation failure', async () => {
    const { setupTabCompletion } = await import('../../../../src/commands/install/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      '../../../../src/commands/install/output-install-completion.mts'
    )

    const error = new Error('Failed to install completion')
    vi.mocked(setupTabCompletion).mockResolvedValue({
      ok: false,
      error,
    })

    await handleInstallCompletion('zsh')

    expect(setupTabCompletion).toHaveBeenCalledWith('zsh')
    expect(outputInstallCompletion).toHaveBeenCalledWith({
      ok: false,
      error,
    })
  })

  it('handles different shell targets', async () => {
    const { setupTabCompletion } = await import('../../../../src/commands/install/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      '../../../../src/commands/install/output-install-completion.mts'
    )

    const shells = ['bash', 'zsh', 'fish', 'powershell']

    for (const shell of shells) {
      vi.mocked(setupTabCompletion).mockResolvedValue({
        ok: true,
        value: `Completion for ${shell} installed`,
      })

      // eslint-disable-next-line no-await-in-loop
      await handleInstallCompletion(shell)

      expect(setupTabCompletion).toHaveBeenCalledWith(shell)
      expect(outputInstallCompletion).toHaveBeenCalledWith({
        ok: true,
        value: `Completion for ${shell} installed`,
      })
    }
  })

  it('handles empty target name', async () => {
    const { setupTabCompletion } = await import('../../../../src/commands/install/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      '../../../../src/commands/install/output-install-completion.mts'
    )

    vi.mocked(setupTabCompletion).mockResolvedValue({
      ok: false,
      error: new Error('Invalid shell target'),
    })

    await handleInstallCompletion('')

    expect(setupTabCompletion).toHaveBeenCalledWith('')
    expect(outputInstallCompletion).toHaveBeenCalledWith({
      ok: false,
      error: new Error('Invalid shell target'),
    })
  })

  it('handles unsupported shell', async () => {
    const { setupTabCompletion } = await import('../../../../src/commands/install/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      '../../../../src/commands/install/output-install-completion.mts'
    )

    vi.mocked(setupTabCompletion).mockResolvedValue({
      ok: false,
      error: new Error('Unsupported shell: tcsh'),
    })

    await handleInstallCompletion('tcsh')

    expect(setupTabCompletion).toHaveBeenCalledWith('tcsh')
    expect(outputInstallCompletion).toHaveBeenCalledWith({
      ok: false,
      error: new Error('Unsupported shell: tcsh'),
    })
  })

  it('handles async errors', async () => {
    const { setupTabCompletion } = await import('../../../../src/commands/install/setup-tab-completion.mts')

    vi.mocked(setupTabCompletion).mockRejectedValue(new Error('Async error'))

    await expect(handleInstallCompletion('bash')).rejects.toThrow('Async error')
  })
})
