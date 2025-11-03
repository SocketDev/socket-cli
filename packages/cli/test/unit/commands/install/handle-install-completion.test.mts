import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleInstallCompletion } from '../../../../../src/commands/../../../../src/commands/install/handle-install-completion.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/../../../../src/commands/install/output-install-completion.mts', () => ({
  outputInstallCompletion: vi.fn(),
}))
vi.mock('../../../../../src/commands/../../../../src/commands/install/setup-tab-completion.mts', () => ({
  setupTabCompletion: vi.fn(),
}))

describe('handleInstallCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs completion successfully', async () => {
    const { setupTabCompletion } = await import('../../../../../src/commands/../src/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      './output-install-completion.mts'
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
    const { setupTabCompletion } = await import('../../../../../src/commands/../src/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      './output-install-completion.mts'
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
    const { setupTabCompletion } = await import('../../../../../src/commands/../src/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      './output-install-completion.mts'
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
    const { setupTabCompletion } = await import('../../../../../src/commands/../src/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      './output-install-completion.mts'
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
    const { setupTabCompletion } = await import('../../../../../src/commands/../src/setup-tab-completion.mts')
    const { outputInstallCompletion } = await import(
      './output-install-completion.mts'
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
    const { setupTabCompletion } = await import('../../../../../src/commands/../src/setup-tab-completion.mts')

    vi.mocked(setupTabCompletion).mockRejectedValue(new Error('Async error'))

    await expect(handleInstallCompletion('bash')).rejects.toThrow('Async error')
  })
})
