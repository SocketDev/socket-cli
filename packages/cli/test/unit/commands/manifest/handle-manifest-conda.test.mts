/**
 * Unit Tests: Conda Manifest Command Handler
 *
 * Purpose:
 * Tests the command handler that converts Conda environment files to requirements.txt format.
 * Validates orchestration between conversion logic and output formatting with support for
 * multiple output formats (text, json, markdown) and verbose mode.
 *
 * Test Coverage:
 * - Successful conversion and requirements output
 * - Conversion failure handling with error propagation
 * - Multiple output format support (text, json, markdown)
 * - Verbose mode flag passing
 * - Different working directory handling (absolute, relative, current)
 *
 * Testing Approach:
 * Mocks convertCondaToRequirements and outputRequirements modules to test handler orchestration
 * without actual file I/O. Uses test helpers for CResult pattern validation.
 *
 * Related Files:
 * - src/commands/manifest/handle-manifest-conda.mts - Command handler
 * - src/commands/manifest/convert-conda-to-requirements.mts - Conversion logic
 * - src/commands/manifest/output-requirements.mts - Output formatting
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleManifestConda } from '../../../../src/commands/manifest/handle-manifest-conda.mts'

// Mock the dependencies.
const mockConvertCondaToRequirements = vi.hoisted(() => vi.fn())
const mockOutputRequirements = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/manifest/convert-conda-to-requirements.mts', () => ({
  convertCondaToRequirements: mockConvertCondaToRequirements,
}))

vi.mock('../../../../src/commands/manifest/output-requirements.mts', () => ({
  outputRequirements: mockOutputRequirements,
}))

describe('handleManifestConda', () => {
  it('converts conda file and outputs requirements successfully', async () => {
    const { convertCondaToRequirements } = await import(
      '../../../../src/commands/manifest/convert-conda-to-requirements.mts'
    )
    const { outputRequirements } = await import('../../../../src/commands/manifest/output-requirements.mts')
    const mockConvert = mockConvertCondaToRequirements
    const mockOutput = mockOutputRequirements

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
      '../../../../src/commands/manifest/convert-conda-to-requirements.mts'
    )
    const { outputRequirements } = await import('../../../../src/commands/manifest/output-requirements.mts')
    const mockConvert = mockConvertCondaToRequirements
    const mockOutput = mockOutputRequirements

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
      '../../../../src/commands/manifest/convert-conda-to-requirements.mts'
    )
    const { outputRequirements } = await import('../../../../src/commands/manifest/output-requirements.mts')
    const mockConvert = mockConvertCondaToRequirements
    const mockOutput = mockOutputRequirements

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
      '../../../../src/commands/manifest/convert-conda-to-requirements.mts'
    )
    const mockConvert = mockConvertCondaToRequirements

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
      '../../../../src/commands/manifest/convert-conda-to-requirements.mts'
    )
    const mockConvert = mockConvertCondaToRequirements

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
