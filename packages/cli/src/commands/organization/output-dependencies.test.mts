import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-dependencies.mts', () => ({
  outputDependencies: vi.fn(),
}))

const { outputDependencies } = await import('./output-dependencies.mts')

describe('outputDependencies', () => {
  it('should be callable with valid result and options', async () => {
    const mockOutput = vi.mocked(outputDependencies)
    mockOutput.mockResolvedValue()

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createSuccessResult({
      end: false,
      rows: [
        {
          branch: 'main',
          direct: true,
          name: 'test-package',
          namespace: '@test',
          repository: 'test-repo',
          type: 'npm',
          version: '1.0.0',
        },
      ],
    })

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(mockOutput).toHaveBeenCalledWith(result, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputDependencies)
    mockOutput.mockResolvedValue()

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createErrorResult('Unauthorized', {
      cause: 'Invalid API token',
      code: 2,
    })

    await outputDependencies(result, {
      limit: 10,
      offset: 0,
      outputKind: 'json',
    })

    expect(mockOutput).toHaveBeenCalledWith(result, expect.objectContaining({
      outputKind: 'json',
    }))
  })

  it('should support different output kinds', async () => {
    const mockOutput = vi.mocked(outputDependencies)
    mockOutput.mockResolvedValue()

    const result: CResult<
      SocketSdkSuccessResult<'searchDependencies'>['data']
    > = createSuccessResult({
      end: true,
      rows: [],
    })

    for (const outputKind of ['json', 'text', 'markdown'] as const) {
      await outputDependencies(result, {
        limit: 10,
        offset: 0,
        outputKind,
      })

      expect(mockOutput).toHaveBeenCalledWith(result, expect.objectContaining({
        outputKind,
      }))
    }
  })
})
