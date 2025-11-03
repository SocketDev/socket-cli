import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleUninstallCompletion } from '../../../../src/handle-uninstall-completion.mts'

// Mock the dependencies.
vi.mock('./output-uninstall-completion.mts', () => ({
  outputUninstallCompletion: vi.fn(),
}))
vi.mock('./teardown-tab-completion.mts', () => ({
  teardownTabCompletion: vi.fn(),
}))

describe('handleUninstallCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uninstalls completion successfully', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )
    const { outputUninstallCompletion } = await import(
      './output-uninstall-completion.mts'
    )

    vi.mocked(teardownTabCompletion).mockResolvedValue({
      ok: true,
      value: 'Completion uninstalled successfully',
    })

    await handleUninstallCompletion('bash')

    expect(teardownTabCompletion).toHaveBeenCalledWith('bash')
    expect(outputUninstallCompletion).toHaveBeenCalledWith(
      {
        ok: true,
        value: 'Completion uninstalled successfully',
      },
      'bash',
    )
  })

  it('handles uninstallation failure', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )
    const { outputUninstallCompletion } = await import(
      './output-uninstall-completion.mts'
    )

    const error = new Error('Failed to uninstall completion')
    vi.mocked(teardownTabCompletion).mockResolvedValue({
      ok: false,
      error,
    })

    await handleUninstallCompletion('zsh')

    expect(teardownTabCompletion).toHaveBeenCalledWith('zsh')
    expect(outputUninstallCompletion).toHaveBeenCalledWith(
      {
        ok: false,
        error,
      },
      'zsh',
    )
  })

  it('handles different shell targets', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )
    const { outputUninstallCompletion } = await import(
      './output-uninstall-completion.mts'
    )

    const shells = ['bash', 'zsh', 'fish', 'powershell']

    for (const shell of shells) {
      vi.mocked(teardownTabCompletion).mockResolvedValue({
        ok: true,
        value: `Completion for ${shell} uninstalled`,
      })

      // eslint-disable-next-line no-await-in-loop
      await handleUninstallCompletion(shell)

      expect(teardownTabCompletion).toHaveBeenCalledWith(shell)
      expect(outputUninstallCompletion).toHaveBeenCalledWith(
        {
          ok: true,
          value: `Completion for ${shell} uninstalled`,
        },
        shell,
      )
    }
  })

  it('handles empty target name', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )
    const { outputUninstallCompletion } = await import(
      './output-uninstall-completion.mts'
    )

    vi.mocked(teardownTabCompletion).mockResolvedValue({
      ok: false,
      error: new Error('Invalid shell target'),
    })

    await handleUninstallCompletion('')

    expect(teardownTabCompletion).toHaveBeenCalledWith('')
    expect(outputUninstallCompletion).toHaveBeenCalledWith(
      {
        ok: false,
        error: new Error('Invalid shell target'),
      },
      '',
    )
  })

  it('handles unsupported shell', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )
    const { outputUninstallCompletion } = await import(
      './output-uninstall-completion.mts'
    )

    vi.mocked(teardownTabCompletion).mockResolvedValue({
      ok: false,
      error: new Error('Unsupported shell: tcsh'),
    })

    await handleUninstallCompletion('tcsh')

    expect(teardownTabCompletion).toHaveBeenCalledWith('tcsh')
    expect(outputUninstallCompletion).toHaveBeenCalledWith(
      {
        ok: false,
        error: new Error('Unsupported shell: tcsh'),
      },
      'tcsh',
    )
  })

  it('handles completion not found', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )
    const { outputUninstallCompletion } = await import(
      './output-uninstall-completion.mts'
    )

    vi.mocked(teardownTabCompletion).mockResolvedValue({
      ok: false,
      error: new Error('Completion not found'),
    })

    await handleUninstallCompletion('bash')

    expect(teardownTabCompletion).toHaveBeenCalledWith('bash')
    expect(outputUninstallCompletion).toHaveBeenCalledWith(
      {
        ok: false,
        error: new Error('Completion not found'),
      },
      'bash',
    )
  })

  it('handles async errors', async () => {
    const { teardownTabCompletion } = await import(
      './teardown-tab-completion.mts'
    )

    vi.mocked(teardownTabCompletion).mockRejectedValue(new Error('Async error'))

    await expect(handleUninstallCompletion('bash')).rejects.toThrow(
      'Async error',
    )
  })
})
