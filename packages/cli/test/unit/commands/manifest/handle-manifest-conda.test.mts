import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../src/helpers/mocks.mts'
import { handleManifestConda } from '../../../../src/src/handle-manifest-conda.mts'

// Mock the dependencies.
vi.mock('./convert-conda-to-requirements.mts', () => ({
  convertCondaToRequirements: vi.fn(),
}))

vi.mock('./output-requirements.mts', () => ({
  outputRequirements: vi.fn(),
}))

describe('handleManifestConda', () => {
  it('converts conda file and outputs requirements successfully', async () => {
    const { convertCondaToRequirements } = await import(
      './convert-conda-to-requirements.mts'
    )
    const { outputRequirements } = await import('./output-requirements.mts')
    const mockConvert = vi.mocked(convertCondaToRequirements)
    const mockOutput = vi.mocked(outputRequirements)

    const mockRequirements = createSuccessResult([
      'numpy==1.23.0',
      'pandas>=2.0.0',
      'scikit-learn~=1.3.0',
      'matplotlib',
    ])
    mockConvert.mockResolvedValue(mockRequirements)

    await handleManifestConda({
      cwd: '/project',
      filename: 'environment.yml',
      out: 'requirements.txt',
      outputKind: 'text',
      verbose: true,
    })

    expect(mockConvert).toHaveBeenCalledWith(
      'environment.yml',
      '/project',
      true,
    )
    expect(mockOutput).toHaveBeenCalledWith(
      mockRequirements,
      'text',
      'requirements.txt',
    )
  })

  it('handles conversion failure', async () => {
    const { convertCondaToRequirements } = await import(
      './convert-conda-to-requirements.mts'
    )
    const { outputRequirements } = await import('./output-requirements.mts')
    const mockConvert = vi.mocked(convertCondaToRequirements)
    const mockOutput = vi.mocked(outputRequirements)

    const mockError = createErrorResult('Invalid conda file format')
    mockConvert.mockResolvedValue(mockError)

    await handleManifestConda({
      cwd: '/project',
      filename: 'invalid.yml',
      out: '',
      outputKind: 'json',
      verbose: false,
    })

    expect(mockConvert).toHaveBeenCalledWith('invalid.yml', '/project', false)
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'json', '')
  })

  it('handles different output formats', async () => {
    const { convertCondaToRequirements } = await import(
      './convert-conda-to-requirements.mts'
    )
    const { outputRequirements } = await import('./output-requirements.mts')
    const mockConvert = vi.mocked(convertCondaToRequirements)
    const mockOutput = vi.mocked(outputRequirements)

    mockConvert.mockResolvedValue(createSuccessResult([]))

    const formats = ['text', 'json', 'markdown'] as const

    for (const format of formats) {
      // eslint-disable-next-line no-await-in-loop
      await handleManifestConda({
        cwd: '.',
        filename: 'conda.yml',
        out: `output.${format}`,
        outputKind: format,
        verbose: false,
      })

      expect(mockOutput).toHaveBeenCalledWith(
        expect.any(Object),
        format,
        `output.${format}`,
      )
    }
  })

  it('handles verbose mode', async () => {
    const { convertCondaToRequirements } = await import(
      './convert-conda-to-requirements.mts'
    )
    const mockConvert = vi.mocked(convertCondaToRequirements)

    mockConvert.mockResolvedValue(createSuccessResult([]))

    await handleManifestConda({
      cwd: '/verbose',
      filename: 'environment.yaml',
      out: 'reqs.txt',
      outputKind: 'text',
      verbose: true,
    })

    expect(mockConvert).toHaveBeenCalledWith(
      'environment.yaml',
      '/verbose',
      true,
    )
  })

  it('handles different working directories', async () => {
    const { convertCondaToRequirements } = await import(
      './convert-conda-to-requirements.mts'
    )
    const mockConvert = vi.mocked(convertCondaToRequirements)

    mockConvert.mockResolvedValue(createSuccessResult([]))

    const cwds = ['/root', '/home/user/project', './relative', '.']

    for (const cwd of cwds) {
      // eslint-disable-next-line no-await-in-loop
      await handleManifestConda({
        cwd,
        filename: 'conda.yml',
        out: 'requirements.txt',
        outputKind: 'text',
        verbose: false,
      })

      expect(mockConvert).toHaveBeenCalledWith('conda.yml', cwd, false)
    }
  })
})
