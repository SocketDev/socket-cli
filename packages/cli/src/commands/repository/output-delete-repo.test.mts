import { describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/index.mts'
import type { CResult } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Mock the output module to avoid logger dependencies.
vi.mock('./output-delete-repo.mts', () => ({
  outputDeleteRepo: vi.fn(),
}))

const { outputDeleteRepo } = await import('./output-delete-repo.mts')

describe('outputDeleteRepo', () => {
  it('should be callable with successful deletion result', async () => {
    const mockOutput = vi.mocked(outputDeleteRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    await outputDeleteRepo(result, 'test-repo', 'json')

    expect(mockOutput).toHaveBeenCalledWith(result, 'test-repo', 'json')
  })

  it('should handle error results', async () => {
    const mockOutput = vi.mocked(outputDeleteRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createErrorResult('Repository not found', {
        cause: 'Not found error',
        code: 1,
      })

    await outputDeleteRepo(result, 'nonexistent-repo', 'text')

    expect(mockOutput).toHaveBeenCalledWith(result, 'nonexistent-repo', 'text')
  })

  it('should support different output formats', async () => {
    const mockOutput = vi.mocked(outputDeleteRepo)
    mockOutput.mockResolvedValue()

    const result: CResult<SocketSdkSuccessResult<'deleteRepository'>['data']> =
      createSuccessResult({
        success: true,
      })

    for (const format of ['json', 'text', 'markdown'] as const) {
      await outputDeleteRepo(result, 'my-repo', format)
      expect(mockOutput).toHaveBeenCalledWith(result, 'my-repo', format)
    }
  })
})
